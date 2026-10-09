import "server-only";
import { env } from "@/lib/env";

type WsOrigins = { domain: string | null; allowedOrigins: string[] };

function normalizeOrigin(o: string): string | null {
  try {
    const u = new URL(o.includes("://") ? o : `https://${o}`);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Erlaubte Origins eines Sub-Accounts: eigene Domain (+www), allowedOrigins, die App selbst. */
export function allowedOriginsFor(ws: WsOrigins, requestUrl: string): Set<string> {
  const set = new Set<string>();
  const add = (o: string | null) => o && set.add(o);
  if (ws.domain) {
    const d = ws.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    add(normalizeOrigin(`https://${d}`));
    add(normalizeOrigin(`https://www.${d}`));
  }
  for (const o of ws.allowedOrigins) add(normalizeOrigin(o));
  add(normalizeOrigin(env.appUrl()));
  add(normalizeOrigin(new URL(requestUrl).origin));
  return set;
}

/** Origin der Anfrage: Origin-Header, sonst aus dem Referer abgeleitet. */
export function requestOrigin(h: Headers): string | null {
  const o = h.get("origin");
  if (o && o !== "null") return normalizeOrigin(o);
  const r = h.get("referer");
  return r ? normalizeOrigin(r) : null;
}

export function corsHeaders(origin: string | null): HeadersInit {
  return origin
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "86400", Vary: "Origin" }
    : { Vary: "Origin" };
}
