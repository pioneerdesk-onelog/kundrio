import { relativeName } from "../hostname";
import type { ZoneRecord } from "../plan";
import { DnsApiError, fqdn, unquote, type DnsApi, type Fetcher } from "./types";

// INWX Domrobot JSON-RPC (https://www.inwx.de/de/help/apidoc). Sitzung per Cookie.

type RpcResult<T> = { code: number; msg: string; resData?: T };

export function inwxApi(cred: { user: string; password: string }, opts: { baseUrl?: string; fetcher?: Fetcher } = {}): DnsApi {
  const base = opts.baseUrl ?? "https://api.domrobot.com/jsonrpc/";
  const f = opts.fetcher ?? fetch;
  let cookie = "";

  async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await f(base, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ method, params }) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const d = (await res.json().catch(() => ({ code: 0, msg: "unerwartete Antwort" }))) as RpcResult<T>;
    if (d.code < 1000 || d.code >= 2000) throw new DnsApiError(`INWX: ${d.msg} (${d.code})`);
    return d.resData as T;
  }
  async function session<T>(fn: () => Promise<T>): Promise<T> {
    await call("account.login", { user: cred.user, pass: cred.password });
    try {
      return await fn();
    } finally {
      await call("account.logout", {}).catch(() => {});
      cookie = "";
    }
  }

  return {
    async test(zone) {
      await session(() => call("nameserver.info", { domain: zone }));
    },
    async listRecords(zone) {
      return session(async () => {
        const d = await call<{ record?: { id: number; name: string; type: string; content: string; ttl: number }[] }>("nameserver.info", { domain: zone });
        return (d.record ?? []).map((r): ZoneRecord => ({ id: String(r.id), type: r.type, name: fqdn(r.name.toLowerCase(), zone), value: r.type === "TXT" ? unquote(r.content) : r.content, ttl: r.ttl }));
      });
    },
    async createRecord(zone, rec) {
      await session(() => call("nameserver.createRecord", { domain: zone, name: relativeName(rec.name, zone) === "@" ? "" : relativeName(rec.name, zone), type: rec.type, content: rec.value, ttl: rec.ttl }));
    },
    async updateRecord(_zone, existing, value, rec) {
      if (!existing.id) throw new DnsApiError("INWX: Eintrags-ID fehlt");
      await session(() => call("nameserver.updateRecord", { id: Number(existing.id), content: value, ttl: rec.ttl }));
    },
  };
}
