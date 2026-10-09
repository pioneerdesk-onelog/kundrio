import "server-only";
import { randomBytes } from "node:crypto";
import type { Domain, Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { audit } from "../audit";
import { emitEvent } from "../events";
import { enqueue } from "../jobs";
import { open, seal } from "../migrate/secretbox";
import { detectProvider, PROVIDERS, type ProviderKey } from "./catalog";
import { checkDns, checkHttps } from "./check";
import { nextCheckDelayMs, VERIFY_WINDOW_MS } from "./evaluate";
import { normalizeHostname, registrableDomain, relativeName } from "./hostname";
import { planChanges, planHasChanges, planIsApplicable, type PlanStep } from "./plan";
import { apiFor, DnsApiError } from "./providers";
import { desiredRecords, targetConfigFromEnv, verifyValue } from "./records";
import { defaultResolvers, findZone, systemResolver } from "./resolver";
import type { CheckReport, DesiredRecord, DomainPurpose, DomainStatus } from "./types";
import { checkDelegation } from "./delegation";

// Ablauf eigene Domain: anlegen → Anbieter erkennen → Einträge (API, Domain Connect oder manuell) → prüfen → aktiv → überwachen.

export class DomainError extends Error {}

export const records = (d: Pick<Domain, "records">) => (d.records ?? []) as unknown as DesiredRecord[];
export const report = (d: Pick<Domain, "checkReport">) => (d.checkReport ?? null) as unknown as (CheckReport & { zone?: string }) | null;

function appHosts(): string[] {
  const hosts = new Set<string>(["localhost", "127.0.0.1"]);
  try {
    hosts.add(new URL(env.appUrl()).hostname.toLowerCase());
  } catch {
    // APP_URL fehlt – egal
  }
  for (const h of (process.env.APP_HOSTS ?? "").split(",")) if (h.trim()) hosts.add(h.trim().toLowerCase());
  return [...hosts];
}

/** Zone der Domain (per NS-Abfrage), Rückfall auf registrierbare Domain. */
export async function zoneOf(host: string): Promise<{ zone: string; ns: string[] }> {
  const z = await findZone(host, systemResolver()).catch(() => null);
  return z ?? { zone: registrableDomain(host), ns: [] };
}

export async function createDomain(workspaceId: string, input: { hostname: string; purpose: DomainPurpose }, actor: string) {
  const host = normalizeHostname(input.hostname);
  if (!host) throw new DomainError("Bitte einen gültigen Hostnamen angeben, z. B. angebot.ihre-firma.de");
  if (appHosts().includes(host)) throw new DomainError("Diese Adresse gehört zur Plattform selbst.");
  if (await db.domain.findUnique({ where: { hostname: host } })) throw new DomainError("Diese Domain ist bereits eingetragen.");
  const { zone, ns } = await zoneOf(host);
  const provider = detectProvider(ns);
  const verifyToken = randomBytes(16).toString("hex");
  const desired = desiredRecords(host, input.purpose, verifyToken, targetConfigFromEnv(), zone);
  const d = await db.domain.create({
    data: {
      workspaceId,
      hostname: host,
      purpose: input.purpose,
      dnsProvider: provider.key,
      method: provider.api ? "api" : "manual",
      records: desired as unknown as Prisma.InputJsonValue,
      verifyToken,
      status: "pending_dns",
      checkReport: { zone, nameservers: ns } as Prisma.InputJsonValue,
      createdBy: actor,
    },
  });
  await audit({ workspaceId, actor, action: "domain.created", target: d.id, detail: { hostname: host, provider: provider.key } });
  return d;
}

export async function getDomain(workspaceId: string, id: string) {
  const d = await db.domain.findFirst({ where: { id, workspaceId } });
  if (!d) throw new DomainError("Domain nicht gefunden.");
  return d;
}

export function zoneFromDomain(d: Domain): string {
  return (report(d)?.zone as string | undefined) ?? registrableDomain(d.hostname);
}

export function storedCredentials(d: Domain): Record<string, string> | null {
  if (!d.providerCredentials) return null;
  try {
    return JSON.parse(open(d.providerCredentials)) as Record<string, string>;
  } catch {
    return null;
  }
}

/** Vorschau der Änderungen beim Anbieter (nur lesend). Zugangsdaten werden hier nicht gespeichert. */
export async function previewApi(d: Domain, cred: Record<string, string>): Promise<{ zone: string; steps: PlanStep[] }> {
  const zone = zoneFromDomain(d);
  const api = apiFor(d.dnsProvider as ProviderKey, cred);
  const existing = await api.listRecords(zone);
  return { zone, steps: planChanges(records(d), existing) };
}

/** Änderungen schreiben – nur nach ausdrücklicher Bestätigung (UI) und nur ohne Konflikte. */
export async function applyApi(d: Domain, cred: Record<string, string>, opts: { keepCredentials: boolean; actor: string }) {
  const { zone, steps } = await previewApi(d, cred);
  if (!planIsApplicable(steps)) throw new DomainError("Es gibt Konflikte mit bestehenden Einträgen – bitte zuerst manuell lösen.");
  const api = apiFor(d.dnsProvider as ProviderKey, cred);
  const done: string[] = [];
  for (const s of steps) {
    if (s.action === "create") await api.createRecord(zone, s.desired);
    else if (s.action === "update") await api.updateRecord(zone, s.existing, s.newValue, s.desired);
    else continue;
    done.push(`${s.action} ${s.desired.type} ${relativeName(s.desired.name, zone)}`);
  }
  await db.domain.update({
    where: { id: d.id },
    data: { method: "api", providerCredentials: opts.keepCredentials ? seal(JSON.stringify(cred)) : null },
  });
  await audit({ workspaceId: d.workspaceId, actor: opts.actor, action: "domain.dns_applied", target: d.id, detail: { provider: d.dnsProvider, changes: done } });
  await startVerification(d.id, opts.actor);
  return { changes: done, hadChanges: planHasChanges(steps) };
}

async function setStatus(d: Pick<Domain, "id" | "workspaceId" | "hostname" | "status">, to: DomainStatus, data: Prisma.DomainUpdateInput, tx: Prisma.TransactionClient | typeof db = db) {
  await tx.domain.update({ where: { id: d.id }, data: { ...data, status: to } });
  if (d.status !== to) {
    await emitEvent({ workspaceId: d.workspaceId, type: "domain.status_changed", objectType: "domain", objectId: d.id, data: { hostname: d.hostname, from: d.status, to } }, tx);
  }
}

export async function startVerification(id: string, actor: string) {
  const d = await db.domain.findUniqueOrThrow({ where: { id } });
  if (d.status === "pending_dns" || d.status === "error") await setStatus(d, "verifying", {});
  // Bereits geplante Prüfung desselben Datensatzes nicht verdoppeln
  const queued = await db.job.findFirst({ where: { type: "domains.verify", status: "queued", payload: { path: ["domainId"], equals: id } } });
  if (!queued) await enqueue("domains.verify", { domainId: id, attempt: 0, startedAt: new Date().toISOString(), actor });
}

/** Eine Prüfrunde (Job). Plant sich mit Backoff neu ein, bis alles stimmt oder 48 h vorbei sind. */
export async function runVerification(p: { domainId: string; attempt: number; startedAt: string }) {
  const d = await db.domain.findUnique({ where: { id: p.domainId } });
  if (!d || d.status === "removed" || d.status === "active") return;
  const desired = records(d);
  const prev = (report(d) ?? {}) as { nameservers?: string[]; migration?: unknown };
  const rep: CheckReport & { zone?: string; nameservers?: string[]; migration?: unknown; delegation?: Awaited<ReturnType<typeof checkDelegation>> } = { ...(await checkDns(desired, defaultResolvers())), zone: zoneFromDomain(d), nameservers: prev.nameservers, migration: prev.migration };
  // Umzug zu STACKIT DNS: aktiv erst, wenn die Nameserver beim Registrar auf STACKIT zeigen
  if (d.method === "stackit_managed") rep.delegation = await checkDelegation(zoneFromDomain(d), defaultResolvers());
  const delegated = d.method !== "stackit_managed" || Boolean(rep.delegation?.ok);
  const now = new Date();
  if (rep.allRequiredOk && rep.ownership && delegated) {
    if (d.purpose === "landing") rep.https = await checkHttps(d.hostname);
    await db.$transaction(async (tx) => {
      await setStatus(d, "active", { checkReport: rep as unknown as Prisma.InputJsonValue, lastCheckAt: now, verifiedAt: now, certExpiresAt: rep.https?.validTo ? new Date(rep.https.validTo) : null, ...(d.method === "stackit_managed" ? { dnsProvider: "stackit" } : {}) }, tx);
      if (d.purpose === "landing") await allowOrigin(tx, d.workspaceId, d.hostname);
    });
    // Zugangsdaten nur behalten, wenn ausdrücklich gewünscht (sonst schon bei applyApi gelöscht)
    return;
  }
  const elapsed = now.getTime() - new Date(p.startedAt).getTime();
  if (elapsed < VERIFY_WINDOW_MS) {
    await db.domain.update({ where: { id: d.id }, data: { checkReport: rep as unknown as Prisma.InputJsonValue, lastCheckAt: now } });
    await enqueue("domains.verify", { ...p, attempt: p.attempt + 1 }, { runAt: new Date(now.getTime() + nextCheckDelayMs(p.attempt)) });
    return;
  }
  await setStatus(d, "error", { checkReport: rep as unknown as Prisma.InputJsonValue, lastCheckAt: now });
  await notifyAdmins(d.workspaceId, `Domain ${d.hostname}: DNS-Einträge nach 48 Stunden nicht korrekt`, "Bitte die Einträge in der Domain-Verwaltung prüfen und „Erneut prüfen“ wählen.");
}

/** Tägliche Überwachung aktiver Domains: DNS noch korrekt? Zertifikat bald abgelaufen? */
export async function monitorDomains() {
  const active = await db.domain.findMany({ where: { status: "active" } });
  for (const d of active) {
    const now = new Date();
    const prevRep = (report(d) ?? {}) as { nameservers?: string[]; migration?: unknown };
    const rep: CheckReport & { zone?: string; nameservers?: string[]; migration?: unknown; delegation?: Awaited<ReturnType<typeof checkDelegation>> } = { ...(await checkDns(records(d), defaultResolvers())), zone: zoneFromDomain(d), nameservers: prevRep.nameservers, migration: prevRep.migration };
    if (d.method === "stackit_managed") rep.delegation = await checkDelegation(zoneFromDomain(d), defaultResolvers());
    if (d.purpose === "landing") rep.https = await checkHttps(d.hostname);
    if (rep.delegation && !rep.delegation.ok) {
      await setStatus(d, "error", { checkReport: rep as unknown as Prisma.InputJsonValue, lastCheckAt: now });
      await notifyAdmins(d.workspaceId, `Domain ${d.hostname}: Nameserver zeigen nicht mehr auf STACKIT`, `Gefunden: ${rep.delegation.found.join(", ") || "keine"}. Bitte beim Registrar prüfen.`);
      continue;
    }
    if (!rep.allRequiredOk) {
      await setStatus(d, "error", { checkReport: rep as unknown as Prisma.InputJsonValue, lastCheckAt: now });
      await notifyAdmins(d.workspaceId, `Domain ${d.hostname}: DNS-Einträge geändert oder fehlen`, "Die Landingpage ist unter dieser Domain eventuell nicht mehr erreichbar.");
      continue;
    }
    await db.domain.update({ where: { id: d.id }, data: { checkReport: rep as unknown as Prisma.InputJsonValue, lastCheckAt: now, certExpiresAt: rep.https?.validTo ? new Date(rep.https.validTo) : d.certExpiresAt } });
    if (rep.https && (!rep.https.ok || (rep.https.daysLeft ?? 99) < 14)) {
      await notifyAdmins(d.workspaceId, `Domain ${d.hostname}: Zertifikat prüfen`, rep.https.ok ? `Läuft in ${rep.https.daysLeft} Tagen ab – automatische Erneuerung prüfen.` : `HTTPS-Fehler: ${rep.https.error ?? "unbekannt"}`);
    }
  }
}

export async function removeDomain(d: Domain, actor: string) {
  await db.$transaction(async (tx) => {
    await setStatus(d, "removed", { providerCredentials: null }, tx);
    const ws = await tx.workspace.findUniqueOrThrow({ where: { id: d.workspaceId }, select: { allowedOrigins: true } });
    await tx.workspace.update({ where: { id: d.workspaceId }, data: { allowedOrigins: ws.allowedOrigins.filter((o) => o !== `https://${d.hostname}`) } });
  });
  await audit({ workspaceId: d.workspaceId, actor, action: "domain.removed", target: d.id, detail: { hostname: d.hostname } });
}

/** Beacon/Formulare auf der eigenen Domain zulassen (CORS-Freigabe der Analytics). */
async function allowOrigin(tx: Prisma.TransactionClient, workspaceId: string, host: string) {
  const origin = `https://${host}`;
  const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { allowedOrigins: true } });
  if (!ws.allowedOrigins.includes(origin)) await tx.workspace.update({ where: { id: workspaceId }, data: { allowedOrigins: [...ws.allowedOrigins, origin].slice(0, 50) } });
}

/** Eine offene Aufgabe je Titel (keine Dubletten bei täglicher Prüfung), zugewiesen an einen Admin. */
async function notifyAdmins(workspaceId: string, title: string, note: string) {
  const exists = await db.task.findFirst({ where: { workspaceId, title, doneAt: null } });
  if (exists) return;
  const admin = await db.user.findFirst({
    where: {
      active: true,
      OR: [
        { memberships: { some: { workspaceId, OR: [{ role: "ADMIN" }, { roleRef: { key: "admin" } }] } } },
        { agencyRole: { in: ["owner", "admin"] } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  await db.task.create({ data: { workspaceId, title: title.slice(0, 200), dueAt: new Date(), ownerId: admin?.id ?? null } });
  await db.activity.create({ data: { workspaceId, type: "SYSTEM", body: `${title} – ${note}`.slice(0, 1000) } });
}

/** Für Caddy On-Demand-TLS und das Host-Routing: gehört der Host zu einer aktiven/in Prüfung befindlichen Domain? */
export async function servableDomain(host: string) {
  const h = normalizeHostname(host);
  if (!h) return null;
  return db.domain.findFirst({ where: { hostname: h, purpose: "landing", status: { in: ["verifying", "active"] } }, include: { workspace: true } });
}

export function describeProvider(key: string | null) {
  return PROVIDERS[(key ?? "unknown") as ProviderKey] ?? PROVIDERS.unknown;
}

export { verifyValue, DnsApiError };
