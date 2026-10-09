"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { errMessage } from "@/lib/log";
import { ForbiddenError, hasSpecial } from "@/lib/permissions";
import { guard } from "@/lib/permissions/guard";
import { getConnector } from "@/lib/payments/registry";
import { PaymentError } from "@/lib/payments/types";
import { PaymentsError, refundPayment, registerProviderWebhook, saveProvider, syncPayment, testProvider } from "@/lib/payments/service";
import { confirmMatch, confirmSuggestions, connectRevolutBusiness, ignoreTransaction, importCamt, runMatching, syncBankAccount, unmatchTransaction } from "@/lib/payments/reconcile/service";

export type PayState = { error?: string; ok?: string };

const EDIT = { object: "invoices", action: "edit" } as const;

function fail(e: unknown): PayState {
  if (e instanceof ForbiddenError || e instanceof PaymentsError || e instanceof PaymentError) return { error: e.message };
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Eingaben prüfen." };
  throw e;
}

/**
 * Zugangsdaten verwalten: Rechnungen bearbeiten + Schlüssel (API-Schlüssel, Webhook-Geheimnis) + Einstellungen
 * (Standard-Anbieter, Zahlarten gelten für alle Rechnungen des Sub-Accounts).
 */
async function settingsGuard(slug: string) {
  const ctx = await guard(slug, EDIT);
  if (!hasSpecial(ctx.access, "manage_keys") || !hasSpecial(ctx.access, "manage_settings")) {
    throw new ForbiddenError("Zahlungsanbieter verbinden erfordert die Rechte „API-, MCP- und Webhook-Zugänge verwalten“ und „Einstellungen & Branding“.");
  }
  return ctx;
}

const paths = (slug: string) => {
  revalidatePath(`/sa/${slug}/zahlungen`);
  revalidatePath(`/sa/${slug}/zahlungen/anbieter`);
  revalidatePath(`/sa/${slug}/zahlungen/abgleich`);
};

// ---------- Anbieter ----------

export async function saveProviderAction(slug: string, provider: string, _p: PayState, fd: FormData): Promise<PayState> {
  try {
    const { ws, user } = await settingsGuard(slug);
    const conn = getConnector(provider);
    if (!conn) return { error: "Unbekannter Anbieter." };
    const credentials = Object.fromEntries(conn.fields.map((f) => [f.name, String(fd.get(`cred_${f.name}`) ?? "")]));
    await saveProvider(
      ws.id,
      {
        provider,
        mode: fd.get("mode") === "live" ? "live" : "test",
        credentials,
        methods: fd.getAll("methods").map(String),
        active: fd.get("active") === "on",
        isDefault: fd.get("isDefault") === "on",
      },
      `user:${user.id}`,
    );
  } catch (e) {
    return fail(e);
  }
  paths(slug);
  return { ok: "Gespeichert. Bitte „Verbindung testen“." };
}

export async function testProviderAction(slug: string, provider: string): Promise<PayState> {
  try {
    const { ws, user } = await settingsGuard(slug);
    const msg = await testProvider(ws.id, provider, `user:${user.id}`);
    paths(slug);
    return { ok: msg };
  } catch (e) {
    paths(slug);
    return fail(e);
  }
}

export async function registerWebhookAction(slug: string, provider: string): Promise<PayState> {
  try {
    const { ws, user } = await settingsGuard(slug);
    const msg = await registerProviderWebhook(ws.id, provider, `user:${user.id}`);
    paths(slug);
    return { ok: msg };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Zahlungen ----------

export async function syncPaymentAction(slug: string, paymentId: string): Promise<PayState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    const p = await db.payment.findFirst({ where: { id: paymentId, workspaceId: ws.id }, select: { id: true } });
    if (!p) return { error: "Zahlung nicht gefunden." };
    const r = await syncPayment(p.id, `user:${user.id}`);
    paths(slug);
    return { ok: r?.changed ? "Status aktualisiert." : "Unverändert." };
  } catch (e) {
    return fail(e);
  }
}

/** Erstattung: Außenwirkung → Rechnungen bearbeiten + „Freigaben erteilen“, mit Bestätigungsdialog im Formular. */
export async function refundAction(slug: string, paymentId: string, _p: PayState, fd: FormData): Promise<PayState> {
  try {
    const { ws, user, access } = await guard(slug, EDIT);
    if (!hasSpecial(access, "approve")) return { error: "Erstattungen erfordern das Recht „Freigaben erteilen“." };
    const euro = String(fd.get("amount") ?? "").replace(/\./g, "").replace(",", ".").trim();
    const cents = Math.round(Number(euro) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return { error: "Betrag in Euro angeben, z. B. 12,50." };
    if (fd.get("confirm") !== "on") return { error: "Bitte bestätigen, dass die Erstattung ausgelöst werden soll." };
    const r = await refundPayment(ws.id, paymentId, cents, `user:${user.id}`);
    paths(slug);
    return { ok: `Erstattung beauftragt (${r.status}).` };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Kontoabgleich ----------

export async function importCamtAction(slug: string, _p: PayState, fd: FormData): Promise<PayState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Bitte eine CAMT-Datei (XML) wählen." };
    if (file.size > 20 * 1024 * 1024) return { error: "Datei zu groß (max. 20 MB)." };
    const name = file.name.toLowerCase();
    if (name.endsWith(".zip")) return { error: "Bitte die XML-Datei(en) aus dem ZIP einzeln hochladen." };
    const accountId = String(fd.get("accountId") ?? "") || null;
    const r = await importCamt(ws.id, await file.text(), `user:${user.id}`, accountId);
    paths(slug);
    return { ok: `${r.format}: ${r.entries} Umsätze, davon ${r.inserted} neu (${r.duplicates} bereits vorhanden). Automatisch zugeordnet: ${r.auto}, Vorschläge: ${r.suggested}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function connectRevolutAction(slug: string, _p: PayState, fd: FormData): Promise<PayState> {
  try {
    const { ws, user } = await settingsGuard(slug);
    const mode = fd.get("mode") === "live" ? "live" : "test";
    if (mode === "live" && process.env.PAYMENTS_MODE !== "live") return { error: "Live-Anbindung ist auf diesem Server nicht freigeschaltet (PAYMENTS_MODE=live)." };
    await connectRevolutBusiness(
      ws.id,
      {
        name: String(fd.get("name") ?? "").trim().slice(0, 100),
        mode,
        clientId: String(fd.get("clientId") ?? ""),
        privateKey: String(fd.get("privateKey") ?? ""),
        issuer: String(fd.get("issuer") ?? ""),
        code: String(fd.get("code") ?? ""),
        refreshToken: String(fd.get("refreshToken") ?? ""),
      },
      `user:${user.id}`,
    );
    paths(slug);
    return { ok: "Revolut Business verbunden. Umsätze werden täglich abgeholt – oder jetzt „Abrufen“." };
  } catch (e) {
    if (e instanceof Error && !(e instanceof ForbiddenError) && !(e instanceof PaymentsError) && !(e instanceof PaymentError)) return { error: `Verbindung fehlgeschlagen: ${errMessage(e)}` };
    return fail(e);
  }
}

export async function syncBankAction(slug: string, accountId: string): Promise<PayState> {
  try {
    const { ws } = await guard(slug, EDIT);
    const acc = await db.bankAccount.findFirst({ where: { id: accountId, workspaceId: ws.id } });
    if (!acc) return { error: "Konto nicht gefunden." };
    const r = await syncBankAccount(acc.id);
    paths(slug);
    return { ok: r ? `${r.inserted} neue Umsätze, automatisch: ${r.auto}, Vorschläge: ${r.suggested}.` : "Für dieses Konto gibt es keinen automatischen Abruf." };
  } catch (e) {
    paths(slug);
    return fail(e);
  }
}

export async function rematchAction(slug: string): Promise<PayState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    const r = await runMatching(ws.id, undefined, `user:${user.id}`);
    paths(slug);
    return { ok: `Neu bewertet: automatisch ${r.auto}, Vorschläge ${r.suggested}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmSuggestionsAction(slug: string, _p: PayState, fd: FormData): Promise<PayState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    const ids = fd.getAll("ids").map(String).filter((s) => /^[a-z0-9]{10,40}$/.test(s));
    if (!ids.length) return { error: "Keine Vorschläge ausgewählt." };
    const r = await confirmSuggestions(ws.id, ids, `user:${user.id}`);
    paths(slug);
    return r.errors.length ? { error: `${r.ok} bestätigt, ${r.errors.length} Fehler: ${r.errors[0]}` } : { ok: `${r.ok} Zuordnung(en) bestätigt.` };
  } catch (e) {
    return fail(e);
  }
}

export async function manualMatchAction(slug: string, txId: string, _p: PayState, fd: FormData): Promise<PayState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    const number = String(fd.get("number") ?? "").trim();
    if (!number) return { error: "Rechnungsnummer angeben." };
    const inv = await db.invoice.findFirst({ where: { workspaceId: ws.id, kind: "INVOICE", number: { equals: number, mode: "insensitive" } }, select: { id: true } });
    if (!inv) return { error: `Rechnung ${number} nicht gefunden.` };
    await confirmMatch(ws.id, txId, inv.id, `user:${user.id}`);
    paths(slug);
    return { ok: "Zugeordnet." };
  } catch (e) {
    return fail(e);
  }
}

export async function ignoreAction(slug: string, txId: string): Promise<PayState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    await ignoreTransaction(ws.id, txId, `user:${user.id}`);
    paths(slug);
    return { ok: "Ignoriert." };
  } catch (e) {
    return fail(e);
  }
}

export async function unmatchAction(slug: string, txId: string): Promise<PayState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    await unmatchTransaction(ws.id, txId, `user:${user.id}`);
    paths(slug);
    return { ok: "Zuordnung gelöst." };
  } catch (e) {
    return fail(e);
  }
}
