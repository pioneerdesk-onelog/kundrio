import { relativeName } from "../hostname";
import type { ZoneRecord } from "../plan";
import { DnsApiError, fqdn, type DnsApi, type Fetcher } from "./types";

// netcup CCP-API (JSON) – https://www.netcup.com/en/helpcenter/documentation/domain/our-api

type NcRecord = { id: string; hostname: string; type: string; destination: string; priority?: string; deleterecord?: boolean };

export function netcupApi(cred: { customerNumber: string; apiKey: string; apiPassword: string }, opts: { baseUrl?: string; fetcher?: Fetcher } = {}): DnsApi {
  const base = opts.baseUrl ?? "https://ccp.netcup.net/run/webservice/servers/endpoint.php?JSON";
  const f = opts.fetcher ?? fetch;

  async function call<T>(action: string, param: Record<string, unknown>): Promise<T> {
    const res = await f(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, param }) });
    const d = (await res.json().catch(() => ({}))) as { status?: string; statuscode?: number; longmessage?: string; responsedata?: T };
    if (d.status !== "success") throw new DnsApiError(`netcup: ${d.longmessage ?? "Fehler"} (${d.statuscode ?? res.status})`);
    return d.responsedata as T;
  }
  async function session<T>(fn: (sid: string) => Promise<T>): Promise<T> {
    const { apisessionid } = await call<{ apisessionid: string }>("login", { customernumber: cred.customerNumber, apikey: cred.apiKey, apipassword: cred.apiPassword });
    try {
      return await fn(apisessionid);
    } finally {
      await call("logout", { customernumber: cred.customerNumber, apikey: cred.apiKey, apisessionid }).catch(() => {});
    }
  }
  const auth = (sid: string) => ({ customernumber: cred.customerNumber, apikey: cred.apiKey, apisessionid: sid });

  async function info(zone: string, sid: string): Promise<NcRecord[]> {
    const d = await call<{ dnsrecords?: NcRecord[] }>("infoDnsRecords", { ...auth(sid), domainname: zone });
    return d.dnsrecords ?? [];
  }

  return {
    async test(zone) {
      await session((sid) => info(zone, sid));
    },
    async listRecords(zone) {
      return session(async (sid) => (await info(zone, sid)).map((r): ZoneRecord => ({ id: r.id, type: r.type, name: fqdn(r.hostname, zone), value: r.destination.replace(/\.$/, "") })));
    },
    async createRecord(zone, rec) {
      await session((sid) =>
        call("updateDnsRecords", { ...auth(sid), domainname: zone, dnsrecordset: { dnsrecords: [{ hostname: relativeName(rec.name, zone), type: rec.type, destination: rec.value, priority: "", deleterecord: false }] } }),
      );
    },
    async updateRecord(zone, existing, value, rec) {
      await session((sid) =>
        call("updateDnsRecords", { ...auth(sid), domainname: zone, dnsrecordset: { dnsrecords: [{ id: existing.id, hostname: relativeName(rec.name, zone), type: rec.type, destination: value, priority: "", deleterecord: false }] } }),
      );
    },
  };
}
