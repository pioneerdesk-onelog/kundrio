import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";

// Sicherer URL-Abruf für die Wissensbasis (SSRF-Schutz).
// Jede Verbindung geht an genau die geprüfte IP (kein erneutes DNS-Auflösen → kein DNS-Rebinding).

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

function ipv4Blocked(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local + Cloud-Metadaten
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // Multicast + reserviert
  );
}

export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Blocked(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4Blocked(mapped[1]);
    if (s.startsWith("::ffff:")) return true; // hex-notierte v4-mapped: sicherheitshalber blocken
    return (
      s === "::" || s === "::1" ||
      /^f[cd]/.test(s) || // ULA
      /^fe[89ab]/.test(s) || // link-local
      s.startsWith("ff") || // multicast
      s.startsWith("64:ff9b") || // NAT64
      s.startsWith("2001:db8") ||
      s.startsWith("fd00:ec2")
    );
  }
  return true;
}

async function resolveSafe(hostname: string): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`Adresse ${host} ist nicht erlaubt (internes Netz)`);
    return { address: host, family: isIP(host) };
  }
  const all = await lookup(host, { all: true, verbatim: true });
  if (all.length === 0) throw new Error(`Host ${host} nicht auflösbar`);
  for (const a of all) if (isBlockedIp(a.address)) throw new Error(`Host ${host} zeigt auf internes Netz (${a.address})`);
  return all[0];
}

type RawResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

function requestPinned(url: URL, ip: { address: string; family: number }): Promise<RawResponse> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: "GET",
        headers: { "user-agent": "Kundrio/0.1 (Wissensbasis)", accept: "text/html,text/plain,text/markdown;q=0.9,*/*;q=0.1" },
        // DNS-Pinning: immer die geprüfte Adresse verwenden
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
            req.destroy(new Error("Seite ist größer als 2 MB"));
            return;
          }
          chunks.push(d);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung beim Abruf (15 s)")));
    req.on("error", reject);
    req.end();
  });
}

export async function safeFetchText(input: string): Promise<{ url: string; title: string | null; text: string }> {
  let url = new URL(input);
  const deadline = Date.now() + TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Nur http/https erlaubt");
    if (url.username || url.password) throw new Error("URLs mit Zugangsdaten sind nicht erlaubt");
    if (Date.now() > deadline) throw new Error("Zeitüberschreitung beim Abruf (15 s)");
    const ip = await resolveSafe(url.hostname);
    const res = await requestPinned(url, ip);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`Abruf fehlgeschlagen: HTTP ${res.status}`);
    const type = String(res.headers["content-type"] ?? "");
    if (type && !/text\/|application\/(xhtml|xml|json)/.test(type)) throw new Error(`Inhaltstyp ${type} wird nicht unterstützt`);
    const raw = res.body.toString("utf8");
    if (/html/.test(type) || /<html[\s>]/i.test(raw)) {
      const { title, text } = htmlToText(raw);
      return { url: url.toString(), title, text };
    }
    return { url: url.toString(), title: null, text: raw };
  }
  throw new Error(`Zu viele Weiterleitungen (max. ${MAX_REDIRECTS})`);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß" };

export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const decode = (s: string) =>
    s
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
  const text = html
    .replace(/<(script|style|noscript|svg|iframe|template|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<h([1-6])[^>]*>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  const clean = decode(text)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: titleMatch ? decode(titleMatch[1]).replace(/\s+/g, " ").trim() || null : null, text: clean };
}
