import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { isBlockedIp } from "../c-fetch";
import { enrichConfig } from "./config";
import { parseRobots, robotsAllows, type RobotsRules } from "./fetch-rules";

// Abruf öffentlicher Firmen-Websites: SSRF-Schutz wie c-fetch (DNS-Pinning, keine internen Netze),
// zusätzlich robots.txt, Abstand je Domain und eigener User-Agent. Liefert rohes HTML (für Links).

export type FetchedPage = { url: string; html: string; status: number };

const lastHit = new Map<string, number>();
const robotsCache = new Map<string, { at: number; rules: RobotsRules }>();

async function resolve(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const allowPrivate = enrichConfig.allowPrivate();
  if (isIP(host)) {
    if (!allowPrivate && isBlockedIp(host)) throw new Error(`Adresse ${host} ist nicht erlaubt (internes Netz)`);
    return { address: host, family: isIP(host) };
  }
  const all = await lookup(host, { all: true, verbatim: true });
  if (all.length === 0) throw new Error(`Host ${host} nicht auflösbar`);
  if (!allowPrivate) for (const a of all) if (isBlockedIp(a.address)) throw new Error(`Host ${host} zeigt auf internes Netz`);
  return all[0];
}

function requestPinned(url: URL, ip: { address: string; family: number }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolvePromise, reject) => {
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: "GET",
        headers: { "user-agent": enrichConfig.userAgent(), accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "accept-language": "de,en;q=0.7" },
        lookup: (_h, opts, cb) => {
          if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [ip]);
          else cb(null, ip.address, ip.family);
        },
        servername: isIP(url.hostname) ? undefined : url.hostname,
        timeout: enrichConfig.pageTimeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (d: Buffer) => {
          size += d.length;
          if (size > enrichConfig.maxBytes) {
            req.destroy(new Error("Seite ist größer als 2 MB"));
            return;
          }
          chunks.push(d);
        });
        res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung beim Abruf")));
    req.on("error", reject);
    req.end();
  });
}

async function politeDelay(host: string) {
  const last = lastHit.get(host) ?? 0;
  const wait = last + enrichConfig.perHostDelayMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

async function rawGet(input: string): Promise<{ url: URL; status: number; type: string; body: Buffer }> {
  let url = new URL(input);
  for (let hop = 0; hop <= 3; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Nur http/https erlaubt");
    if (url.username || url.password) throw new Error("URLs mit Zugangsdaten sind nicht erlaubt");
    const ip = await resolve(url.hostname);
    await politeDelay(url.host);
    const res = await requestPinned(url, ip);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    return { url, status: res.status, type: String(res.headers["content-type"] ?? ""), body: res.body };
  }
  throw new Error("Zu viele Weiterleitungen");
}

async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < 3600_000) return cached.rules;
  let rules: RobotsRules = { disallow: [], allow: [] };
  try {
    const r = await rawGet(`${origin}/robots.txt`);
    if (r.status >= 200 && r.status < 300) rules = parseRobots(r.body.toString("utf8").slice(0, 200_000));
  } catch {
    // keine robots.txt erreichbar → keine Einschränkung
  }
  robotsCache.set(origin, { at: Date.now(), rules });
  return rules;
}

/** Holt eine HTML-Seite unter Beachtung von robots.txt. Gibt null zurück, wenn robots.txt den Abruf verbietet. */
export async function fetchPage(input: string): Promise<FetchedPage | null> {
  const u = new URL(input);
  const rules = await robotsFor(u.origin);
  if (!robotsAllows(rules, u.pathname || "/")) return null;
  const r = await rawGet(input);
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} bei ${r.url.toString()}`);
  if (r.type && !/html|xml|text\/plain/.test(r.type)) throw new Error(`Inhaltstyp ${r.type} wird nicht ausgewertet`);
  return { url: r.url.toString(), html: r.body.toString("utf8"), status: r.status };
}
