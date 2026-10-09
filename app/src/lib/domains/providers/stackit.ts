import type { ZoneRecord } from "../plan";
import type { DesiredRecord } from "../types";
import { DnsApiError, jsonOrThrow, unquote, type DnsApi, type Fetcher } from "./types";

// STACKIT DNS API v1 (https://dns.api.stackit.cloud, Spezifikation: github.com/stackitcloud/stackit-api-specifications
// services/dns/v1/dns.json). Zonen je Projekt, Einträge als RRSets (name, type, ttl, records[{content}]).
// Schreibvorgänge antworten mit 202 (asynchron, state CREATING/UPDATING → *_SUCCEEDED).
// Belegt: Pfade, Felder, Paging (page/pageSize ≤ 10000), Filter dnsName[eq]/name[eq]/type[eq].
// TXT: ≤ 255 Zeichen unverändert, länger in 255er-Stücke mit Anführungszeichen (wie stackit-cli FormatTxtRecord).
// Nicht belegt (gegen echte API prüfen): Punkt am Ende bei CNAME/MX-Zielen – wir senden FQDN mit Punkt.

export type StackitZone = { id: string; dnsName: string; state: string; active?: boolean; primaryNameServer?: string; error?: string };
export type StackitRRSet = { id: string; name: string; type: string; ttl: number; state: string; active?: boolean; records: { id?: string; content: string }[] };

export const STACKIT_NAMESERVERS = ["ns1.stackit.cloud", "ns2.stackit.zone"];

const dot = (n: string) => (n.endsWith(".") ? n : `${n}.`);
const undot = (n: string) => n.replace(/\.$/, "").toLowerCase();

/** TXT-Inhalt wie die offizielle CLI formatieren. */
export function formatTxt(value: string): string {
  if (value.length <= 255) return value;
  if (value.length > 4049) throw new DnsApiError("STACKIT: TXT-Wert länger als 4049 Zeichen");
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += 255) parts.push(JSON.stringify(value.slice(i, i + 255)));
  return parts.join(" ");
}

/** Inhalt aus der API für Vergleiche normalisieren (TXT-Stücke zusammenfügen, Punkt am Ende entfernen). */
export function normalizeContent(type: string, content: string): string {
  const t = type.toUpperCase();
  if (t === "TXT") return /^"/.test(content.trim()) ? unquote(content.trim()) : content;
  if (t === "CNAME" || t === "NS" || t === "ALIAS") return undot(content);
  if (t === "MX") return content.replace(/\.$/, "").toLowerCase();
  return content;
}

export function contentFor(rec: Pick<DesiredRecord, "type" | "value">): string {
  if (rec.type === "TXT") return formatTxt(rec.value);
  if (rec.type === "CNAME") return dot(rec.value.toLowerCase());
  if (rec.type === "MX") {
    const m = rec.value.match(/^(\d+)\s+(\S+)$/);
    return m ? `${m[1]} ${dot(m[2].toLowerCase())}` : rec.value;
  }
  return rec.value;
}

export function stackitClient(opts: { projectId: string; token: () => Promise<string>; baseUrl?: string; fetcher?: Fetcher }) {
  const base = (opts.baseUrl ?? "https://dns.api.stackit.cloud").replace(/\/$/, "");
  const f = opts.fetcher ?? fetch;
  const p = encodeURIComponent(opts.projectId);
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await f(`${base}/v1/projects/${p}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await opts.token()}`, "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    return jsonOrThrow(res, "STACKIT DNS");
  };

  async function findZone(dnsName: string): Promise<StackitZone | null> {
    const d = (await call(`/zones?dnsName[eq]=${encodeURIComponent(undot(dnsName))}&pageSize=100`)) as { zones?: StackitZone[] };
    return (d.zones ?? []).find((z) => undot(z.dnsName) === undot(dnsName) && !String(z.state).startsWith("DELET")) ?? null;
  }

  async function zoneId(dnsName: string) {
    const z = await findZone(dnsName);
    if (!z) throw new DnsApiError(`STACKIT DNS: Zone ${dnsName} ist nicht im Pioneerdesk-Projekt`);
    return z.id;
  }

  async function listRRSets(zid: string): Promise<StackitRRSet[]> {
    const out: StackitRRSet[] = [];
    for (let page = 1; page <= 20; page++) {
      const d = (await call(`/zones/${encodeURIComponent(zid)}/rrsets?page=${page}&pageSize=1000`)) as { rrSets?: StackitRRSet[]; totalPages?: number };
      out.push(...(d.rrSets ?? []).filter((s) => !String(s.state).startsWith("DELET")));
      if (!d.totalPages || page >= d.totalPages) break;
    }
    return out;
  }

  return {
    findZone,
    zoneId,
    listRRSets,
    async getZone(zid: string) {
      return ((await call(`/zones/${encodeURIComponent(zid)}`)) as { zone: StackitZone }).zone;
    },
    /** Primäre Zone anlegen (asynchron, 202). */
    async createZone(dnsName: string, input: { name: string; contactEmail?: string; description?: string; defaultTTL?: number }) {
      const body = { dnsName: undot(dnsName), name: input.name.slice(0, 63), type: "primary", contactEmail: input.contactEmail, description: input.description?.slice(0, 1024), defaultTTL: input.defaultTTL ?? 3600 };
      return ((await call(`/zones`, { method: "POST", body: JSON.stringify(body) })) as { zone: StackitZone }).zone;
    },
    async createRRSet(zid: string, set: { name: string; type: string; ttl?: number; records: string[]; comment?: string }) {
      const body = { name: dot(undot(set.name)), type: set.type, ttl: set.ttl, comment: set.comment ?? "Kundrio", records: set.records.map((content) => ({ content })) };
      return ((await call(`/zones/${encodeURIComponent(zid)}/rrsets`, { method: "POST", body: JSON.stringify(body) })) as { rrset: StackitRRSet }).rrset;
    },
    async patchRRSet(zid: string, rrSetId: string, patch: { ttl?: number; records: string[] }) {
      const body = { ttl: patch.ttl, records: patch.records.map((content) => ({ content })) };
      return ((await call(`/zones/${encodeURIComponent(zid)}/rrsets/${encodeURIComponent(rrSetId)}`, { method: "PATCH", body: JSON.stringify(body) })) as { rrset: StackitRRSet }).rrset;
    },
    /** Zonen-Export der API (Format bind/csv/json); Antwortformat in der Spezifikation nicht beschrieben → Rohtext. */
    async exportZone(zid: string, format: "bind" | "json" | "csv" = "bind"): Promise<string> {
      const res = await f(`${base}/v1/projects/${p}/zones/${encodeURIComponent(zid)}/export`, {
        method: "POST",
        headers: { authorization: `Bearer ${await opts.token()}`, "content-type": "application/json" },
        body: JSON.stringify({ format, exportAsFQDN: true }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new DnsApiError(`STACKIT DNS: Export fehlgeschlagen (HTTP ${res.status})`, res.status);
      return res.text();
    },
  };
}

export type StackitClient = ReturnType<typeof stackitClient>;

/** DnsApi-Adapter (gleiche Schnittstelle wie die übrigen Anbieter): nur eigene Einträge anlegen/ändern. */
export function stackitApi(client: StackitClient): DnsApi {
  const toRecords = (sets: StackitRRSet[]): ZoneRecord[] =>
    sets.flatMap((s) => s.records.map((r): ZoneRecord => ({ id: s.id, type: s.type, name: undot(s.name), value: normalizeContent(s.type, r.content), ttl: s.ttl })));
  return {
    async test(zone) {
      await client.zoneId(zone);
    },
    async listRecords(zone) {
      return toRecords(await client.listRRSets(await client.zoneId(zone)));
    },
    async createRecord(zone, rec) {
      const zid = await client.zoneId(zone);
      const sets = await client.listRRSets(zid);
      const existing = sets.find((s) => undot(s.name) === undot(rec.name) && s.type === rec.type);
      if (existing) {
        // RRSet existiert (z. B. weitere TXT unter dem Namen) → Wert ergänzen, vorhandene Werte bleiben
        await client.patchRRSet(zid, existing.id, { ttl: existing.ttl, records: [...existing.records.map((r) => r.content), contentFor(rec)] });
      } else {
        await client.createRRSet(zid, { name: rec.name, type: rec.type, ttl: rec.ttl, records: [contentFor(rec)] });
      }
    },
    async updateRecord(zone, existing, value, rec) {
      const zid = await client.zoneId(zone);
      const set = (await client.listRRSets(zid)).find((s) => undot(s.name) === undot(rec.name) && s.type === rec.type);
      if (!set) throw new DnsApiError("STACKIT DNS: RRSet nicht gefunden");
      // Nur den betroffenen Wert ersetzen
      const records = set.records.map((r) => (normalizeContent(set.type, r.content) === existing.value ? contentFor({ type: rec.type, value }) : r.content));
      await client.patchRRSet(zid, set.id, { ttl: set.ttl, records });
    },
  };
}
