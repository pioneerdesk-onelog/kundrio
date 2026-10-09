import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { isBlockedIp } from "../c-fetch";

// Rohabruf für die Website-CI-Auswertung (HTML, CSS, Logo-Bilder) mit SSRF-Schutz wie c-fetch:
// DNS-Pinning auf die geprüfte Adresse, keine internen Netze, max. 3 Weiterleitungen, Größen-/Zeitlimit.
// Interne Ziele nur außerhalb der Produktion mit BRAND_FETCH_ALLOW_PRIVATE=true (für lokale Tests).

export type RawFetch = { url: string; status: number; contentType: string; body: Buffer };

const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

const allowPrivate = () => process.env.BRAND_FETCH_ALLOW_PRIVATE === "true" && process.env.NODE_ENV !== "production";

async function resolveSafe(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!allowPrivate() && isBlockedIp(host)) throw new Error(`Adresse ${host} ist nicht erlaubt (internes Netz)`);
    return { address: host, family: isIP(host) };
  }
  const all = await lookup(host, { all: true, verbatim: true });
  if (all.length === 0) throw new Error(`Host ${host} nicht auflösbar`);
  if (!allowPrivate()) for (const a of all) if (isBlockedIp(a.address)) throw new Error(`Host ${host} zeigt auf ein internes Netz`);
  return all[0];
}

function requestPinned(url: URL, ip: { address: string; family: number }, maxBytes: number, accept: string) {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: "GET",
        headers: { "user-agent": "Kundrio-Branding/1.0", accept, "accept-language": "de,en;q=0.7" },
        lookup: (_h, opts, cb) => {
          if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [ip]);
          else cb(null, ip.address, ip.family);
        },
        servername: isIP(url.hostname) ? undefined : url.hostname,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (d: Buffer) => {
          size += d.length;
          if (size > maxBytes) {
            req.destroy(new Error(`Datei ist größer als ${Math.round(maxBytes / 1024)} KB`));
            return;
          }
          chunks.push(d);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung beim Abruf")));
    req.on("error", reject);
    req.end();
  });
}

export async function fetchRaw(input: string, opts: { maxBytes?: number; accept?: string } = {}): Promise<RawFetch> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Nur http/https erlaubt");
    if (url.username || url.password) throw new Error("URLs mit Zugangsdaten sind nicht erlaubt");
    const ip = await resolveSafe(url.hostname);
    const res = await requestPinned(url, ip, opts.maxBytes ?? 2 * 1024 * 1024, opts.accept ?? "text/html,application/xhtml+xml,text/css,*/*;q=0.5");
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`Abruf fehlgeschlagen: HTTP ${res.status} (${url.host})`);
    return { url: url.toString(), status: res.status, contentType: String(res.headers["content-type"] ?? ""), body: res.body };
  }
  throw new Error(`Zu viele Weiterleitungen (max. ${MAX_REDIRECTS})`);
}
