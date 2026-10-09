import type { ZoneRecord } from "../plan";
import type { DesiredRecord } from "../types";
import { DnsApiError, jsonOrThrow, unquote, type DnsApi, type Fetcher } from "./types";

// IONOS Developer API – DNS (https://developer.hosting.ionos.de/docs/dns), Header X-API-Key: <präfix>.<geheimnis>

export function ionosApi(cred: { apiKey: string }, opts: { baseUrl?: string; fetcher?: Fetcher } = {}): DnsApi {
  const base = (opts.baseUrl ?? "https://api.hosting.ionos.com/dns/v1").replace(/\/$/, "");
  const f = opts.fetcher ?? fetch;
  const headers = { "X-API-Key": cred.apiKey, accept: "application/json", "content-type": "application/json" };

  async function zoneId(zone: string): Promise<string> {
    const zones = (await jsonOrThrow(await f(`${base}/zones`, { headers }), "IONOS")) as { id: string; name: string }[];
    const z = zones.find((x) => x.name.toLowerCase() === zone);
    if (!z) throw new DnsApiError(`IONOS: Zone ${zone} nicht in diesem Konto`);
    return z.id;
  }

  return {
    async test(zone) {
      await zoneId(zone);
    },
    async listRecords(zone) {
      const id = await zoneId(zone);
      const data = (await jsonOrThrow(await f(`${base}/zones/${id}`, { headers }), "IONOS")) as { records?: { id: string; name: string; type: string; content: string; ttl?: number }[] };
      return (data.records ?? []).map((r): ZoneRecord => ({ id: r.id, name: r.name.toLowerCase(), type: r.type, value: r.type === "TXT" ? unquote(r.content) : r.content, ttl: r.ttl }));
    },
    async createRecord(zone, rec: DesiredRecord) {
      const id = await zoneId(zone);
      const res = await f(`${base}/zones/${id}/records`, {
        method: "POST",
        headers,
        body: JSON.stringify([{ name: rec.name, type: rec.type, content: rec.value, ttl: rec.ttl, prio: 0, disabled: false }]),
      });
      await jsonOrThrow(res, "IONOS");
    },
    async updateRecord(zone, existing, value, rec) {
      const id = await zoneId(zone);
      if (!existing.id) throw new DnsApiError("IONOS: Eintrags-ID fehlt");
      const res = await f(`${base}/zones/${id}/records/${existing.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ content: value, ttl: rec.ttl, prio: 0, disabled: false }),
      });
      await jsonOrThrow(res, "IONOS");
    },
  };
}
