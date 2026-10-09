"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard, forbiddenToState } from "@/lib/permissions/guard";
import { seal } from "@/lib/migrate/secretbox";
import { PROVIDERS, type ProviderKey } from "@/lib/domains/catalog";
import { checkDns } from "@/lib/domains/check";
import { discover } from "@/lib/domains/domainconnect";
import { relativeName } from "@/lib/domains/hostname";
import { planHasChanges, planIsApplicable, type PlanStep } from "@/lib/domains/plan";
import { targetConfigFromEnv, verifyValue } from "@/lib/domains/records";
import { defaultResolvers, systemResolver } from "@/lib/domains/resolver";
import { applyApi, createDomain, DomainError, getDomain, previewApi, records, removeDomain, startVerification, storedCredentials, zoneFromDomain } from "@/lib/domains/service";
import type { FormState } from "@/components/users/StateForm";
import { applyMigration, platformAvailable, prepareMigration, updateMigration } from "@/lib/domains/stackit-migration";

// Domains verwalten: nur mit Sonderrecht „Einstellungen“ (manage_settings).
const NEED = { special: "manage_settings" } as const;
const actor = (id: string) => `user:${id}`;
const fail = (e: unknown): FormState => forbiddenToState(e) ?? { error: (e instanceof Error ? e.message : String(e)).slice(0, 400) };

export async function createDomainAction(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  let id: string;
  try {
    const { ws, user } = await guard(slug, NEED);
    const p = z.object({ hostname: z.string().trim().min(3).max(253), purpose: z.enum(["landing", "mail"]) }).parse({ hostname: fd.get("hostname"), purpose: fd.get("purpose") });
    id = (await createDomain(ws.id, p, actor(user.id))).id;
  } catch (e) {
    return fail(e);
  }
  redirect(`/sa/${slug}/domains/${id}`);
}

export type PreviewState = FormState & { steps?: { action: PlanStep["action"]; type: string; name: string; value: string; current?: string; note: string }[]; applicable?: boolean; changes?: boolean };

const credSchema = z.record(z.string(), z.string().trim().max(500));

/** Schritt 1 (API): Zugangsdaten prüfen und geplante Änderungen anzeigen – noch nichts schreiben. */
export async function previewApiAction(slug: string, id: string, _prev: PreviewState, fd: FormData): Promise<PreviewState> {
  try {
    const { ws } = await guard(slug, NEED);
    const d = await getDomain(ws.id, id);
    const provider = PROVIDERS[(d.dnsProvider ?? "unknown") as ProviderKey];
    if (!provider.api) throw new DomainError("Für diesen Anbieter gibt es keine automatische Schnittstelle.");
    const cred = credSchema.parse(Object.fromEntries((provider.apiFields ?? []).map((f) => [f.key, String(fd.get(f.key) ?? "")])));
    const { zone, steps } = await previewApi(d, cred);
    // Zugangsdaten verschlüsselt zwischenspeichern, bis bestätigt oder verworfen wird
    await db.domain.update({ where: { id: d.id }, data: { providerCredentials: seal(JSON.stringify(cred)), method: "api" } });
    return {
      ok: `Verbindung zu ${provider.name} hergestellt (Zone ${zone}). Bitte die Änderungen prüfen und bestätigen.`,
      applicable: planIsApplicable(steps),
      changes: planHasChanges(steps),
      steps: steps.map((s) => ({
        action: s.action,
        type: s.desired.type,
        name: relativeName(s.desired.name, zone),
        value: s.action === "update" ? s.newValue : s.desired.value,
        current: s.action === "update" || s.action === "keep" ? s.existing.value : s.action === "conflict" ? s.existing.map((x) => `${x.type} ${x.value}`).join(", ") : undefined,
        note: s.note,
      })),
    };
  } catch (e) {
    return fail(e);
  }
}

/** Schritt 2 (API): bestätigte Änderungen schreiben, dann Prüfung starten. */
export async function applyApiAction(slug: string, id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, NEED);
    if (fd.get("confirm") !== "on") return { error: "Bitte bestätigen, dass die angezeigten Einträge geschrieben werden dürfen." };
    const d = await getDomain(ws.id, id);
    const cred = storedCredentials(d);
    if (!cred) return { error: "Zugangsdaten fehlen – bitte zuerst die Vorschau erzeugen." };
    const r = await applyApi(d, cred, { keepCredentials: fd.get("keep") === "on", actor: actor(user.id) });
    revalidatePath(`/sa/${slug}/domains/${id}`);
    return { ok: r.hadChanges ? `Eingetragen: ${r.changes.join(", ")}. Die Prüfung läuft automatisch.` : "Alle Einträge waren bereits korrekt. Die Prüfung läuft." };
  } catch (e) {
    return fail(e);
  }
}

/** Zwischengespeicherte Zugangsdaten verwerfen. */
export async function forgetCredentialsAction(slug: string, id: string, _prev: FormState): Promise<FormState> {
  try {
    const { ws } = await guard(slug, NEED);
    await getDomain(ws.id, id);
    await db.domain.update({ where: { id }, data: { providerCredentials: null } });
    revalidatePath(`/sa/${slug}/domains/${id}`);
    return { ok: "Zugangsdaten gelöscht." };
  } catch (e) {
    return fail(e);
  }
}

/** Sofortprüfung (für die Anzeige) + Hintergrundprüfung mit Wiederholung einplanen. */
export async function checkNowAction(slug: string, id: string, _prev: FormState): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, NEED);
    const d = await getDomain(ws.id, id);
    const rep = await checkDns(records(d), defaultResolvers());
    // Umzugsstand und Nameserver-Info nicht überschreiben
    const prev = (d.checkReport ?? {}) as { nameservers?: string[]; migration?: unknown };
    await db.domain.update({ where: { id }, data: { checkReport: { ...rep, zone: zoneFromDomain(d), nameservers: prev.nameservers, migration: prev.migration } as unknown as Prisma.InputJsonValue, lastCheckAt: new Date() } });
    if (d.status !== "active") await startVerification(d.id, actor(user.id));
    revalidatePath(`/sa/${slug}/domains/${id}`);
    const ok = rep.records.filter((r) => r.status === "ok").length;
    return rep.allRequiredOk
      ? { ok: "Alle Einträge stimmen. Die Domain wird in Kürze aktiviert (inkl. HTTPS-Prüfung)." }
      : { ok: `${ok} von ${rep.records.length} Einträgen stimmen. Wir prüfen automatisch weiter (bis zu 48 Stunden).` };
  } catch (e) {
    return fail(e);
  }
}

export type DcState = FormState & { applyUrl?: string };

export async function domainConnectAction(slug: string, id: string, _prev: DcState): Promise<DcState> {
  try {
    const { ws } = await guard(slug, NEED);
    const d = await getDomain(ws.id, id);
    const zone = zoneFromDomain(d);
    const host = relativeName(d.hostname, zone);
    const r = await discover(zone, systemResolver(), { host, target: targetConfigFromEnv().cnameTarget, verify: verifyValue(d.verifyToken) });
    if (!r.supported) return { error: r.reason };
    if (!r.templateReady || !r.applyUrl) return { error: r.reason ?? "Domain Connect ist für diese Domain derzeit nicht nutzbar." };
    await db.domain.update({ where: { id }, data: { method: "domain_connect" } });
    return { ok: `${r.settings.providerDisplayName ?? r.settings.providerName}: Bitte die Änderung beim Anbieter bestätigen.`, applyUrl: r.applyUrl };
  } catch (e) {
    return fail(e);
  }
}

export async function removeDomainAction(slug: string, id: string, _prev: FormState): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, NEED);
    const d = await getDomain(ws.id, id);
    await removeDomain(d, actor(user.id));
  } catch (e) {
    return fail(e);
  }
  redirect(`/sa/${slug}/domains`);
}

// ---------- Umzug zu STACKIT DNS (verwaltet durch Pioneerdesk) ----------

export type MigrationState = FormState & { done?: boolean };

/** Bestand erfassen – optional mit Zugangsdaten des bisherigen Anbieters (vollständige Liste), sonst per DNS. */
export async function prepareStackitAction(slug: string, id: string, _prev: MigrationState, fd: FormData): Promise<MigrationState> {
  try {
    const { ws, user } = await guard(slug, NEED);
    if (!platformAvailable()) return { error: "STACKIT DNS ist auf dieser Plattform noch nicht eingerichtet." };
    const d = await getDomain(ws.id, id);
    const provider = PROVIDERS[(d.dnsProvider ?? "unknown") as ProviderKey];
    const cred = provider.api && !provider.platformManaged ? credSchema.parse(Object.fromEntries((provider.apiFields ?? []).map((f) => [f.key, String(fd.get(f.key) ?? "")]))) : undefined;
    const m = await prepareMigration(d, { cred, actor: actor(user.id) });
    revalidatePath(`/sa/${slug}/domains/${id}`);
    return { ok: `${m.items.length} Einträge erfasst (${m.source === "api" ? "vollständig über die API" : "über DNS-Abfragen"}). Bitte prüfen, auswählen und ergänzen.` };
  } catch (e) {
    return fail(e);
  }
}

/** Auswahl + manuelle Ergänzungen speichern. */
export async function saveStackitSelectionAction(slug: string, id: string, _prev: MigrationState, fd: FormData): Promise<MigrationState> {
  try {
    const { ws } = await guard(slug, NEED);
    const d = await getDomain(ws.id, id);
    const include = new Set(fd.getAll("include").map(String));
    await updateMigration(d, include, String(fd.get("manual") ?? "").slice(0, 20_000));
    revalidatePath(`/sa/${slug}/domains/${id}`);
    return { ok: "Auswahl gespeichert." };
  } catch (e) {
    return fail(e);
  }
}

/** Zone bei STACKIT anlegen und Einträge übertragen – nur nach ausdrücklicher Bestätigung. */
export async function applyStackitAction(slug: string, id: string, _prev: MigrationState, fd: FormData): Promise<MigrationState> {
  try {
    const { ws, user } = await guard(slug, NEED);
    if (fd.get("confirm") !== "on") return { error: "Bitte bestätigen, dass die ausgewählten Einträge vollständig sind." };
    const d = await getDomain(ws.id, id);
    const r = await applyMigration(d, actor(user.id));
    revalidatePath(`/sa/${slug}/domains/${id}`);
    return { ok: `Zone bei STACKIT angelegt, ${r.applied.length} Änderungen übertragen. Jetzt beim Registrar die Nameserver auf ${r.nameservers.join(" und ")} umstellen – wir prüfen automatisch.`, done: true };
  } catch (e) {
    return fail(e);
  }
}
