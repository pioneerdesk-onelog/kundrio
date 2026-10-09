import { relativeName } from "../hostname";
import type { ZoneRecord } from "../plan";
import { fqdn, jsonOrThrow, type DnsApi, type Fetcher } from "./types";

// GoDaddy Domains API v1 (https://developer.godaddy.com/doc/endpoint/domains), Header Authorization: sso-key KEY:SECRET.
// Seit 04/2026 ab einer Domain im Konto verfügbar (vorher ≥ 10 Domains).

type GdRecord = { type: string; name: string; data: string; ttl: number };

export function godaddyApi(cred: { apiKey: string; apiSecret: string }, opts: { baseUrl?: string; fetcher?: Fetcher } = {}): DnsApi {
  const base = (opts.baseUrl ?? "https://api.godaddy.com").replace(/\/$/, "");
  const f = opts.fetcher ?? fetch;
  const headers = { authorization: `sso-key ${cred.apiKey}:${cred.apiSecret}`, "content-type": "application/json", accept: "application/json" };

  async function all(zone: string): Promise<GdRecord[]> {
    return (await jsonOrThrow(await f(`${base}/v1/domains/${zone}/records`, { headers }), "GoDaddy")) as GdRecord[];
  }

  return {
    async test(zone) {
      await jsonOrThrow(await f(`${base}/v1/domains/${zone}`, { headers }), "GoDaddy");
    },
    async listRecords(zone) {
      return (await all(zone)).map((r): ZoneRecord => ({ id: `${r.type}/${r.name}`, type: r.type, name: fqdn(r.name, zone), value: r.data.replace(/\.$/, ""), ttl: r.ttl }));
    },
    async createRecord(zone, rec) {
      // PATCH fügt hinzu, ohne bestehende Einträge zu ersetzen
      await jsonOrThrow(
        await f(`${base}/v1/domains/${zone}/records`, { method: "PATCH", headers, body: JSON.stringify([{ type: rec.type, name: relativeName(rec.name, zone), data: rec.value, ttl: Math.max(600, rec.ttl) }]) }),
        "GoDaddy",
      );
    },
    async updateRecord(zone, existing, value, rec) {
      // PUT ersetzt alle Werte dieses Typs+Namens → übrige Werte mitsenden
      const name = relativeName(rec.name, zone);
      const current = (await all(zone)).filter((r) => r.type === rec.type && r.name === name);
      const next = current.map((r) => (r.data.replace(/\.$/, "") === existing.value ? { data: value, ttl: Math.max(600, rec.ttl) } : { data: r.data, ttl: r.ttl }));
      await jsonOrThrow(await f(`${base}/v1/domains/${zone}/records/${rec.type}/${encodeURIComponent(name)}`, { method: "PUT", headers, body: JSON.stringify(next) }), "GoDaddy");
    },
  };
}
