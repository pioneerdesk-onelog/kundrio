"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, hasSpecial } from "@/lib/permissions";
import { guard } from "@/lib/permissions/guard";
import { itemSchema } from "@/lib/invoice";
import { requestApproval } from "@/lib/approvals";
import { storeFile } from "@/lib/storage";
import { INTERVALS, parseDay } from "@/lib/billing/periods";
import { isValidCreditorId } from "@/lib/billing/sepa";
import { parseDunningSettings } from "@/lib/billing/dunning";
import {
  BillingError,
  cancelSubscription,
  createDebitBatch,
  createMandate,
  createSubscription,
  dunningDraft,
  markBatchSettled,
  markBatchSubmitted,
  recordReturn,
  revokeMandate,
  runBilling,
  runDunning,
  saveDunningSettings,
  setAutoSend,
  setSubscriptionPaused,
} from "@/lib/billing/service";

export type AboState = { error?: string; ok?: string };

const EDIT = { object: "invoices", action: "edit" } as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum fehlt");

/** Fachliche Fehler und fehlende Rechte als Inline-Meldung; alles andere weiterwerfen. */
function fail(e: unknown): AboState {
  if (e instanceof ForbiddenError || e instanceof BillingError) return { error: e.message };
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Eingaben prüfen." };
  throw e;
}

// ---------- Produkte ----------

const productSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(200),
  description: z.string().trim().max(1000),
  unitCents: z.coerce.number().int().min(0).max(100_000_000),
  vatRate: z.coerce.number().refine((v) => [19, 7, 0].includes(v), "USt-Satz 19, 7 oder 0 %"),
  interval: z.enum(INTERVALS),
});

export async function saveProduct(slug: string, id: string | null, _p: AboState, fd: FormData): Promise<AboState> {
  try {
    const { ws } = await guard(slug, EDIT);
    const euro = String(fd.get("price") ?? "").replace(/\./g, "").replace(",", ".");
    const data = productSchema.parse({
      name: fd.get("name"),
      description: String(fd.get("description") ?? ""),
      unitCents: Math.round(Number(euro) * 100),
      vatRate: fd.get("vatRate"),
      interval: fd.get("interval"),
    });
    if (id) {
      const r = await db.product.updateMany({ where: { id, workspaceId: ws.id }, data: { ...data, description: data.description || null } });
      if (!r.count) return { error: "Produkt nicht gefunden." };
    } else {
      await db.product.create({ data: { ...data, description: data.description || null, workspaceId: ws.id } });
    }
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/sa/${slug}/abos/produkte`);
  return { ok: "Gespeichert." };
}

export async function toggleProduct(slug: string, id: string) {
  const { ws } = await guard(slug, EDIT);
  const p = await db.product.findFirst({ where: { id, workspaceId: ws.id } });
  if (p) await db.product.update({ where: { id: p.id }, data: { active: !p.active } });
  revalidatePath(`/sa/${slug}/abos/produkte`);
}

// ---------- Abos ----------

const subSchema = z.object({
  contactId: z.string().min(1, "Kontakt wählen").max(40),
  interval: z.enum(INTERVALS),
  startDate: day,
  minTermMonths: z.coerce.number().int().min(0).max(60),
  noticePeriodDays: z.coerce.number().int().min(0).max(365),
  paymentMethod: z.enum(["sepa", "transfer"]),
  mandateId: z.string().max(40).optional(),
  consumer: z.boolean(),
  items: z.array(itemSchema).min(1, "Mindestens eine Position").max(50),
});

export async function createSubscriptionAction(slug: string, _p: AboState, fd: FormData): Promise<AboState> {
  let id: string;
  try {
    const { ws, user } = await guard(slug, EDIT);
    const d = subSchema.parse({
      contactId: fd.get("contactId"),
      interval: fd.get("interval"),
      startDate: fd.get("startDate"),
      minTermMonths: fd.get("minTermMonths") || 0,
      noticePeriodDays: fd.get("noticePeriodDays") || 0,
      paymentMethod: fd.get("paymentMethod"),
      mandateId: String(fd.get("mandateId") ?? "") || undefined,
      consumer: fd.get("consumer") === "on",
      items: JSON.parse(String(fd.get("items") ?? "[]")),
    });
    const sub = await createSubscription(ws.id, { ...d, startDate: parseDay(d.startDate) }, `user:${user.id}`);
    id = sub.id;
  } catch (e) {
    if (e instanceof SyntaxError) return { error: "Positionen konnten nicht gelesen werden." };
    return fail(e);
  }
  redirect(`/sa/${slug}/abos/${id}`);
}

export async function cancelSubscriptionAction(slug: string, id: string, _p: AboState, fd: FormData): Promise<AboState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    const at = String(fd.get("requestedAt") ?? "");
    const r = await cancelSubscription(ws.id, id, `user:${user.id}`, { requestedAt: at ? parseDay(at) : undefined });
    revalidatePath(`/sa/${slug}/abos/${id}`);
    return { ok: r.already ? "Abo war bereits gekündigt." : `Gekündigt zum ${r.effective?.toISOString().slice(0, 10)}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function pauseSubscriptionAction(slug: string, id: string, paused: boolean) {
  const { ws, user } = await guard(slug, EDIT);
  await setSubscriptionPaused(ws.id, id, paused, `user:${user.id}`);
  revalidatePath(`/sa/${slug}/abos/${id}`);
}

/** „Automatisch versenden“: nur Menschen mit invoices.edit; wird mit Person und Zeit gespeichert. */
export async function setAutoSendAction(slug: string, id: string, enabled: boolean) {
  const { ws, user } = await guard(slug, EDIT);
  if (!(await db.subscription.findFirst({ where: { id, workspaceId: ws.id } }))) throw new BillingError("Abo nicht gefunden.");
  await setAutoSend(id, enabled, `user:${user.id}`);
  revalidatePath(`/sa/${slug}/abos/${id}`);
}

/** Abrechnungslauf sofort (statt auf den nächtlichen Job zu warten). */
export async function runBillingNow(slug: string, _p: AboState): Promise<AboState> {
  try {
    const { ws } = await guard(slug, EDIT);
    const r = await runBilling(ws.id);
    revalidatePath(`/sa/${slug}/abos`);
    return { ok: r.created ? `${r.created} Rechnung(en) als Entwurf erstellt.` : "Keine fälligen Abo-Perioden." };
  } catch (e) {
    return fail(e);
  }
}

/** Kundenportal-Link neu ausstellen (alte Links werden ungültig). */
export async function rotatePortalLink(slug: string, contactId: string) {
  const { ws } = await guard(slug, EDIT);
  if (!(await db.contact.findFirst({ where: { id: contactId, workspaceId: ws.id } }))) return;
  const key = `billing:portal:${contactId}`;
  const cur = await db.appSetting.findUnique({ where: { key } });
  const version = (((cur?.value ?? {}) as { version?: number }).version ?? 1) + 1;
  await db.appSetting.upsert({ where: { key }, create: { key, value: { version } }, update: { value: { version } } });
  revalidatePath(`/sa/${slug}/abos`, "layout");
}

// ---------- Mandate ----------

const mandateSchema = z.object({
  contactId: z.string().min(1, "Kontakt wählen").max(40),
  accountHolder: z.string().trim().min(1, "Kontoinhaber fehlt").max(70),
  iban: z.string().trim().min(15, "IBAN fehlt").max(42),
  bic: z.string().trim().max(11),
  scheme: z.enum(["CORE", "B1"]),
  signedAt: day,
});

export async function createMandateAction(slug: string, _p: AboState, fd: FormData): Promise<AboState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    const d = mandateSchema.parse(Object.fromEntries(["contactId", "accountHolder", "iban", "bic", "scheme", "signedAt"].map((k) => [k, String(fd.get(k) ?? "")])));
    const m = await createMandate(ws.id, { ...d, bic: d.bic || null, signedAt: parseDay(d.signedAt) }, `user:${user.id}`);
    revalidatePath(`/sa/${slug}/abos/mandate`);
    return { ok: `Mandat ${m.mandateRef} angelegt.` };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeMandateAction(slug: string, id: string) {
  const { ws, user } = await guard(slug, EDIT);
  await revokeMandate(ws.id, id, `user:${user.id}`);
  revalidatePath(`/sa/${slug}/abos/mandate`);
}

/** Nachweis (unterschriebenes Mandat als PDF/Bild) hochladen. */
export async function uploadMandateProof(slug: string, id: string, _p: AboState, fd: FormData): Promise<AboState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    const m = await db.sepaMandate.findFirst({ where: { id, workspaceId: ws.id } });
    if (!m) return { error: "Mandat nicht gefunden." };
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Bitte eine Datei wählen." };
    const { file: stored } = await storeFile({ workspaceId: ws.id, kind: "document", name: file.name, data: new Uint8Array(await file.arrayBuffer()), createdBy: `user:${user.id}` });
    await db.sepaMandate.update({ where: { id: m.id }, data: { proofFileId: stored.id } });
    revalidatePath(`/sa/${slug}/abos/mandate`);
    return { ok: "Nachweis gespeichert." };
  } catch (e) {
    if (e instanceof Error && !(e instanceof ForbiddenError) && /Dateityp|zu groß|nicht erlaubt/i.test(e.message)) return { error: e.message };
    return fail(e);
  }
}

// ---------- Lastschrift ----------

export async function createBatchAction(slug: string, _p: AboState, fd: FormData): Promise<AboState> {
  let id: string;
  try {
    const { ws, user } = await guard(slug, EDIT);
    const ids = fd.getAll("invoiceId").map(String).filter(Boolean);
    if (!ids.length) return { error: "Bitte Rechnungen auswählen." };
    id = (await createDebitBatch(ws.id, ids, `user:${user.id}`)).id;
  } catch (e) {
    return fail(e);
  }
  redirect(`/sa/${slug}/abos/lastschrift/${id}`);
}

/** Eingereicht markieren: Außenwirkung (Geld fließt) → zusätzlich Recht „Freigaben erteilen“. */
export async function submitBatchAction(slug: string, id: string, _p: AboState): Promise<AboState> {
  try {
    const { ws, user, access } = await guard(slug, EDIT);
    if (!hasSpecial(access, "approve")) return { error: "Für die Einreichung ist das Recht „Freigaben erteilen“ nötig." };
    await markBatchSubmitted(ws.id, id, `user:${user.id}`);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/sa/${slug}/abos/lastschrift/${id}`);
  return { ok: "Als eingereicht markiert." };
}

export async function settleBatchAction(slug: string, id: string, _p: AboState): Promise<AboState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    await markBatchSettled(ws.id, id, `user:${user.id}`);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/sa/${slug}/abos/lastschrift/${id}`);
  return { ok: "Einzug abgeschlossen, Rechnungen als bezahlt markiert." };
}

export async function returnItemAction(slug: string, batchId: string, itemId: string, _p: AboState, fd: FormData): Promise<AboState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    const reason = String(fd.get("reason") ?? "").slice(0, 10) || "MS02";
    const fee = Math.round(Number(String(fd.get("fee") ?? "0").replace(",", ".")) * 100) || 0;
    await recordReturn(ws.id, itemId, reason, Math.max(0, fee), `user:${user.id}`);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/sa/${slug}/abos/lastschrift/${batchId}`);
  return { ok: "Rücklastschrift erfasst. Die Rechnung ist wieder offen." };
}

// ---------- Mahnwesen ----------

export async function saveDunningAction(slug: string, _p: AboState, fd: FormData): Promise<AboState> {
  try {
    const { ws } = await guard(slug, EDIT);
    const num = (k: string) => Number(fd.get(k) ?? 0);
    const fee = (k: string) => Math.round(Number(String(fd.get(k) ?? "0").replace(",", ".")) * 100) || 0;
    const text = (l: string) => ({ subject: String(fd.get(`subject${l}`) ?? "").slice(0, 300), body: String(fd.get(`body${l}`) ?? "").slice(0, 8000) });
    const s = parseDunningSettings({
      enabled: fd.get("enabled") === "on",
      daysToLevel1: num("days1"),
      daysToLevel2: num("days2"),
      daysToLevel3: num("days3"),
      feeCents: [fee("fee1"), fee("fee2"), fee("fee3")],
      texts: { "1": text("1"), "2": text("2"), "3": text("3") },
    });
    await saveDunningSettings(ws.id, s);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/sa/${slug}/abos/mahnwesen`);
  return { ok: "Mahnwesen gespeichert." };
}

export async function runDunningNow(slug: string, _p: AboState): Promise<AboState> {
  try {
    const { ws } = await guard(slug, EDIT);
    const r = await runDunning(ws.id);
    revalidatePath(`/sa/${slug}/abos/mahnwesen`);
    return { ok: r.requested ? `${r.requested} Mahnung(en) warten im Freigabe-Eingang.` : "Keine Mahnung fällig." };
  } catch (e) {
    return fail(e);
  }
}

/** Einzelne Mahnung manuell anstoßen – geht ebenfalls über den Freigabe-Eingang. */
export async function requestDunningAction(slug: string, invoiceId: string, level: number) {
  const { ws, user } = await guard(slug, EDIT);
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, workspaceId: ws.id, status: "SENT" } });
  if (!inv) return;
  const open = await db.approval.count({ where: { workspaceId: ws.id, kind: "dunning.send", status: "pending", payload: { path: ["invoiceId"], equals: invoiceId } } });
  if (open) return;
  const draft = await dunningDraft(ws.id, invoiceId, level);
  await requestApproval({ workspaceId: ws.id, kind: "dunning.send", title: `Mahnstufe ${level} zu ${inv.number} senden`, summary: `An ${draft.to}: ${draft.subject}`, payload: { invoiceId, level, ...draft }, requestedBy: `user:${user.id}` });
  revalidatePath(`/sa/${slug}/abos/mahnwesen`);
}

// ---------- Gläubiger-ID (Einstellungen) ----------

export async function saveCreditorId(slug: string, _p: AboState, fd: FormData): Promise<AboState> {
  try {
    const { ws } = await guard(slug, { special: "manage_settings" });
    const v = String(fd.get("creditorId") ?? "").replace(/\s+/g, "").toUpperCase();
    if (v && !isValidCreditorId(v)) return { error: "Die Gläubiger-ID ist ungültig (Prüfziffer). Format z. B. DE98ZZZ09999999999." };
    await db.workspace.update({ where: { id: ws.id }, data: { creditorId: v || null } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/sa/${slug}`, "layout");
  return { ok: "Gläubiger-ID gespeichert." };
}
