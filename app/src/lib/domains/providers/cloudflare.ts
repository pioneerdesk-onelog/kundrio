import type { ZoneRecord } from "../plan";
import { DnsApiError, jsonOrThrow, unquote, type DnsApi, type Fetcher } from "./types";

// Cloudflare API v4 (https://developers.cloudflare.com/api/resources/dns/), Bearer-Token mit Zone:DNS:Edit

type CfList<T> = { success: boolean; result: T[] };

export function cloudflareApi(cred: { apiToken: string }, opts: { baseUrl?: string; fetcher?: Fetcher } = {}): DnsApi {
  const base = (opts.baseUrl ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
  const f = opts.fetcher ?? fetch;
  const headers = { authorization: `Bearer ${cred.apiToken}`, "content-type": "application/json" };

  async function zoneId(zone: string) {
    const d = (await jsonOrThrow(await f(`${base}/zones?name=${encodeURIComponent(zone)}`, { headers }), "Cloudflare")) as CfList<{ id: string }>;
    if (!d.result?.[0]) throw new DnsApiError(`Cloudflare: Zone ${zone} nicht für dieses Token freigegeben`);
    return d.result[0].id;
  }

  return {
    async test(zone) {
      await zoneId(zone);
    },
    async listRecords(zone) {
      const id = await zoneId(zone);
      const d = (await jsonOrThrow(await f(`${base}/zones/${id}/dns_records?per_page=500`, { headers }), "Cloudflare")) as CfList<{ id: string; type: string; name: string; content: string; ttl: number }>;
      return d.result.map((r): ZoneRecord => ({ id: r.id, type: r.type, name: r.name.toLowerCase(), value: r.type === "TXT" ? unquote(r.content) : r.content, ttl: r.ttl }));
    },
    async createRecord(zone, rec) {
      const id = await zoneId(zone);
      await jsonOrThrow(
        await f(`${base}/zones/${id}/dns_records`, {
          method: "POST",
          headers,
          // proxied:false – sonst stellt Cloudflare eigene Zertifikate/IPs vor unser Ziel
          body: JSON.stringify({ type: rec.type, name: rec.name, content: rec.value, ttl: rec.ttl, proxied: false, comment: "Kundrio" }),
        }),
        "Cloudflare",
      );
    },
    async updateRecord(zone, existing, value, rec) {
      const id = await zoneId(zone);
      if (!existing.id) throw new DnsApiError("Cloudflare: Eintrags-ID fehlt");
      await jsonOrThrow(await f(`${base}/zones/${id}/dns_records/${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ content: value, ttl: rec.ttl }) }), "Cloudflare");
    },
  };
}
