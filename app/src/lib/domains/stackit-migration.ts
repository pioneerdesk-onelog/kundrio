import "server-only";
import type { Domain, Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { PROVIDERS, type ProviderKey } from "./catalog";
import { inventoryFromApi, inventoryFromDns, mergeItems, parseManualLines, type InventoryItem } from "./inventory";
import { planChanges, planIsApplicable } from "./plan";
import { apiFor, platformStackitClient } from "./providers";
import { contentFor, normalizeContent, STACKIT_NAMESERVERS, stackitApi, type StackitClient } from "./providers/stackit";
import { systemResolver, type DnsLookup } from "./resolver";
export { checkDelegation } from "./delegation";
import { records, report, startVerification, zoneFromDomain, DomainError } from "./service";
import { stackitPlatformConfig } from "./stackit-auth";
import { toBindZone } from "./zonefile";

// Umzug der DNS-Verwaltung zu STACKIT DNS (Projekt von Pioneerdesk): Bestand erfassen → prüfen → Zone anlegen →
// Einträge übernehmen → Nameserver beim Registrar umstellen → Delegation prüfen. Rückweg: BIND-Zonendatei.

export type Migration = {
  items: InventoryItem[];
  warnings: string[];
  source: "dns" | "api";
  preparedAt: string;
  appliedAt?: string;
  zoneId?: string;
  applied?: string[];
  delegatedAt?: string;
};

export const platformAvailable = () => stackitPlatformConfig().configured;
export const migrationOf = (d: Pick<Domain, "checkReport">) => ((report(d) as { migration?: Migration } | null)?.migration ?? null);

async function saveMigration(d: Domain, m: Migration) {
  const rep = (report(d) ?? {}) as Record<string, unknown>;
  await db.domain.update({ where: { id: d.id }, data: { checkReport: { ...rep, migration: m } as unknown as Prisma.InputJsonValue } });
}

/** Schritt 1: Ist-Bestand erfassen (API des bisherigen Anbieters, wenn Zugangsdaten angegeben, sonst DNS-Abfragen). */
export async function prepareMigration(d: Domain, opts: { cred?: Record<string, string>; actor: string; resolver?: DnsLookup }) {
  const zone = zoneFromDomain(d);
  const provider = PROVIDERS[(d.dnsProvider ?? "unknown") as ProviderKey] ?? PROVIDERS.unknown;
  let inv: { items: InventoryItem[]; warnings: string[] };
  let source: Migration["source"] = "dns";
  if (opts.cred && provider.api && !provider.platformManaged && Object.values(opts.cred).some(Boolean)) {
    inv = inventoryFromApi(zone, await apiFor(provider.key, opts.cred).listRecords(zone));
    source = "api";
  } else {
    inv = await inventoryFromDns(zone, opts.resolver ?? systemResolver());
  }
  const m: Migration = { items: inv.items, warnings: inv.warnings, source, preparedAt: new Date().toISOString() };
  await saveMigration(d, m);
  await audit({ workspaceId: d.workspaceId, actor: opts.actor, action: "domain.migration_prepared", target: d.id, detail: { zone, source, items: inv.items.length } });
  return m;
}

/** Schritt 2: Auswahl speichern und manuelle Ergänzungen übernehmen. */
export async function updateMigration(d: Domain, include: Set<string>, manualText: string) {
  const m = migrationOf(d);
  if (!m) throw new DomainError("Bitte zuerst den Bestand erfassen.");
  if (m.appliedAt) throw new DomainError("Die Einträge wurden bereits zu STACKIT übertragen.");
  const zone = zoneFromDomain(d);
  const manual = parseManualLines(zone, manualText);
  if (manual.errors.length) throw new DomainError(manual.errors.join(" · "));
  const items = mergeItems(m.items.map((i) => ({ ...i, include: include.has(`${i.type} ${i.name}`) })), manual.items);
  const next = { ...m, items };
  await saveMigration(d, next);
  return next;
}

async function waitZoneReady(client: StackitClient, zoneId: string, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const z = await client.getZone(zoneId);
    if (z.state === "CREATE_SUCCEEDED" || z.state === "UPDATE_SUCCEEDED") return z;
    if (z.state.endsWith("FAILED")) throw new DomainError(`STACKIT: Zone konnte nicht angelegt werden (${z.error ?? z.state}).`);
    await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** i, 5000)));
  }
  throw new DomainError("STACKIT legt die Zone noch an – bitte in einer Minute erneut „Übertragen“ wählen.");
}

/** Schritt 3: Zone bei STACKIT anlegen und ausgewählte + eigene Einträge übertragen. Bricht bei Konflikten ab, bevor etwas geschrieben wird. */
export async function applyMigration(d: Domain, actor: string, client: StackitClient = platformStackitClient()) {
  const m = migrationOf(d);
  if (!m) throw new DomainError("Bitte zuerst den Bestand erfassen.");
  const zone = zoneFromDomain(d);
  const chosen = m.items.filter((i) => i.include);

  // Konflikte zwischen übernommenem Bestand und eigenen Einträgen vorab prüfen (z. B. A-Eintrag vs. unser CNAME)
  const asZone = chosen.flatMap((i) => i.values.map((value) => ({ type: i.type, name: i.name, value, ttl: i.ttl })));
  const preSteps = planChanges(records(d), asZone);
  if (!planIsApplicable(preSteps)) {
    const c = preSteps.filter((s) => s.action === "conflict").map((s) => s.note);
    throw new DomainError(`Konflikt mit übernommenen Einträgen: ${c.join(" ")} Bitte den betroffenen Eintrag abwählen oder einen anderen Hostnamen nutzen.`);
  }

  let z = await client.findZone(zone);
  if (!z) {
    z = await client.createZone(zone, { name: zone.replace(/[^a-z0-9-]/gi, "-").slice(0, 63), contactEmail: process.env.STACKIT_DNS_CONTACT_EMAIL || `hostmaster@${zone}`, description: `Kundrio – ${d.workspaceId}` });
  }
  await waitZoneReady(client, z.id);

  const existing = await client.listRRSets(z.id);
  const applied: string[] = [];
  for (const it of chosen) {
    const contents = it.values.map((v) => contentFor({ type: it.type as never, value: v }));
    const set = existing.find((s) => s.name.replace(/\.$/, "").toLowerCase() === it.name && s.type === it.type);
    if (set) {
      const have = set.records.map((r) => normalizeContent(set.type, r.content));
      const missing = it.values.filter((v) => !have.includes(normalizeContent(it.type, contentFor({ type: it.type as never, value: v }))));
      if (!missing.length) continue;
      await client.patchRRSet(z.id, set.id, { ttl: set.ttl, records: [...set.records.map((r) => r.content), ...missing.map((v) => contentFor({ type: it.type as never, value: v }))] });
      applied.push(`ergänzt ${it.type} ${it.name}`);
    } else {
      await client.createRRSet(z.id, { name: it.name, type: it.type, ttl: it.ttl, records: contents, comment: `übernommen (${it.source})` });
      applied.push(`neu ${it.type} ${it.name}`);
    }
  }

  // Eigene Soll-Einträge (Landingpage/Besitznachweis/Mail) über den gemeinsamen Plan
  const api = stackitApi(client);
  const steps = planChanges(records(d), await api.listRecords(zone));
  for (const s of steps) {
    if (s.action === "create") await api.createRecord(zone, s.desired);
    else if (s.action === "update") await api.updateRecord(zone, s.existing, s.newValue, s.desired);
    else continue;
    applied.push(`${s.action === "create" ? "neu" : "geändert"} ${s.desired.type} ${s.desired.name}`);
  }

  const fresh = await db.domain.findUniqueOrThrow({ where: { id: d.id } });
  await saveMigration(fresh, { ...m, appliedAt: new Date().toISOString(), zoneId: z.id, applied });
  await db.domain.update({ where: { id: d.id }, data: { method: "stackit_managed", providerCredentials: null } });
  await audit({ workspaceId: d.workspaceId, actor, action: "domain.migrated_to_stackit", target: d.id, detail: { zone, zoneId: z.id, changes: applied.length } });
  await startVerification(d.id, actor);
  return { zoneId: z.id, applied, nameservers: STACKIT_NAMESERVERS };
}

/** Zonendatei (BIND) – bevorzugt aus der STACKIT-API, sonst aus Bestand + Soll-Einträgen erzeugt. */
export async function exportZoneFile(d: Domain): Promise<{ filename: string; text: string; source: "stackit" | "generated" }> {
  const zone = zoneFromDomain(d);
  const m = migrationOf(d);
  if (m?.zoneId && platformAvailable()) {
    try {
      const text = await platformStackitClient().exportZone(m.zoneId, "bind");
      if (text.trim()) return { filename: `${zone}.zone`, text, source: "stackit" };
    } catch {
      // Rückfall auf lokale Erzeugung
    }
  }
  const own = records(d).map((r) => ({ type: r.type, name: r.name, values: [r.value], ttl: r.ttl }));
  const items = mergeItems((m?.items ?? []).filter((i) => i.include), own.map((o) => ({ ...o, source: "manual" as const, include: true })));
  return { filename: `${zone}.zone`, text: toBindZone(zone, items, { nameservers: STACKIT_NAMESERVERS }), source: "generated" };
}
