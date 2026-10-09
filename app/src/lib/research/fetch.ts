import "server-only";
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedIp } from "../c-fetch";

// SSRF-sicherer Rohabruf (HTML/XML) für Firmen-Websites und Feeds – gleiche Regeln wie src/lib/c-fetch.ts
// (nur http/https, keine internen Adressen, DNS-Pinning, Weiterleitungen neu geprüft), aber ohne HTML→Text,
// weil Links und Feeds ausgewertet werden.

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

async function resolveSafe(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`Adresse ${host} ist nicht erlaubt (internes Netz)`);
    return { address: host, family: isIP(host) };
  }
  const all = await lookup(host, { all: true, verbatim: true });
  if (all.length === 0) throw new Error(`Host ${host} nicht auflösbar`);
  for (const a of all) if (isBlockedIp(a.address)) throw new Error(`Host ${host} zeigt auf internes Netz`);
  return all[0];
}

function get(url: URL, ip: { address: string; family: number }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: "GET",
        headers: { "user-agent": "Kundrio/0.1 (Recherche)", accept: "text/html,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.1" },
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
          if (size > MAX_BYTES) {
            req.destroy(new Error("Antwort zu groß"));
            return;
          }
          chunks.push(d);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung")));
    req.on("error", reject);
    req.end();
  });
}

/** Rohtext einer öffentlichen Seite (HTML/XML). Wirft bei internen Zielen, Fehlern oder fremden Inhaltstypen. */
export async function safeFetchRaw(input: string): Promise<{ url: string; contentType: string; body: string }> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Nur http/https erlaubt");
    if (url.username || url.password) throw new Error("URLs mit Zugangsdaten sind nicht erlaubt");
    const ip = await resolveSafe(url.hostname);
    const res = await get(url, ip);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    const type = String(res.headers["content-type"] ?? "");
    if (type && !/text\/|xml|xhtml/i.test(type)) throw new Error(`Inhaltstyp ${type} nicht unterstützt`);
    return { url: url.toString(), contentType: type, body: res.body };
  }
  throw new Error("Zu viele Weiterleitungen");
}
