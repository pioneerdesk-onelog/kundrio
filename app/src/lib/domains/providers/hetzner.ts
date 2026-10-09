import { relativeName } from "../hostname";
import type { ZoneRecord } from "../plan";
import { DnsApiError, fqdn, jsonOrThrow, unquote, type DnsApi, type Fetcher } from "./types";

// Hetzner Cloud API – DNS-Zonen mit RRSets (https://docs.hetzner.cloud/reference/cloud#zones).
// Die alte DNS-API (dns.hetzner.com) ist seit 05/2026 abgeschaltet. Umsetzung nach Doku, gegen Mock getestet.

type RRSet = { id: string; name: string; type: string; ttl: number | null; records: { value: string; comment?: string }[] };

const quoteTxt = (v: string) => (v.startsWith('"') ? v : `"${v.replace(/"/g, '\\"')}"`);

export function hetznerApi(cred: { apiToken: string }, opts: { baseUrl?: string; fetcher?: Fetcher } = {}): DnsApi {
  const base = (opts.baseUrl ?? "https://api.hetzner.cloud/v1").replace(/\/$/, "");
  const f = opts.fetcher ?? fetch;
  const headers = { authorization: `Bearer ${cred.apiToken}`, "content-type": "application/json" };

  async function zoneId(zone: string) {
    const d = (await jsonOrThrow(await f(`${base}/zones?name=${encodeURIComponent(zone)}`, { headers }), "Hetzner")) as { zones: { id: number | string; name: string }[] };
    const z = d.zones?.find((x) => x.name.toLowerCase() === zone);
    if (!z) throw new DnsApiError(`Hetzner: Zone ${zone} nicht im Projekt dieses Tokens`);
    return String(z.id);
  }

  async function rrsets(zone: string): Promise<RRSet[]> {
    const id = await zoneId(zone);
    const d = (await jsonOrThrow(await f(`${base}/zones/${id}/rrsets?per_page=100`, { headers }), "Hetzner")) as { rrsets: RRSet[] };
    return d.rrsets ?? [];
  }

  return {
    async test(zone) {
      await zoneId(zone);
    },
    async listRecords(zone) {
      return (await rrsets(zone)).flatMap((s) =>
        s.records.map((r): ZoneRecord => ({ id: `${s.name}/${s.type}`, type: s.type, name: fqdn(s.name, zone), value: s.type === "TXT" ? unquote(r.value) : r.value.replace(/\.$/, ""), ttl: s.ttl ?? undefined })),
      );
    },
    async createRecord(zone, rec) {
      const id = await zoneId(zone);
      const name = relativeName(rec.name, zone);
      const value = rec.type === "TXT" ? quoteTxt(rec.value) : rec.type === "CNAME" ? `${rec.value}.` : rec.value;
      // Existiert das RRSet schon (z. B. weitere TXT unter dem Namen), Eintrag hinzufügen; sonst RRSet anlegen
      const existing = (await rrsets(zone)).find((s) => s.name === name && s.type === rec.type);
      const res = existing
        ? await f(`${base}/zones/${id}/rrsets/${encodeURIComponent(name)}/${rec.type}/actions/add_records`, { method: "POST", headers, body: JSON.stringify({ ttl: rec.ttl, records: [{ value, comment: "Kundrio" }] }) })
        : await f(`${base}/zones/${id}/rrsets`, { method: "POST", headers, body: JSON.stringify({ name, type: rec.type, ttl: rec.ttl, records: [{ value, comment: "Kundrio" }] }) });
      await jsonOrThrow(res, "Hetzner");
    },
    async updateRecord(zone, existing, value, rec) {
      const id = await zoneId(zone);
      const name = relativeName(rec.name, zone);
      const set = (await rrsets(zone)).find((s) => s.name === name && s.type === rec.type);
      if (!set) throw new DnsApiError("Hetzner: RRSet nicht gefunden");
      const fmt = (v: string) => (rec.type === "TXT" ? quoteTxt(v) : rec.type === "CNAME" ? `${v.replace(/\.$/, "")}.` : v);
      // Nur den betroffenen Wert ersetzen, übrige Werte des RRSets bleiben erhalten
      const records = set.records.map((r) => ((rec.type === "TXT" ? unquote(r.value) : r.value.replace(/\.$/, "")) === existing.value ? { value: fmt(value), comment: "Kundrio" } : r));
      await jsonOrThrow(await f(`${base}/zones/${id}/rrsets/${encodeURIComponent(name)}/${rec.type}/actions/set_records`, { method: "POST", headers, body: JSON.stringify({ records }) }), "Hetzner");
    },
  };
}
