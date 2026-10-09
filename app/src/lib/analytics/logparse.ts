// Parser für Webserver-Access-Logs (nginx/Apache „combined“ und Caddy-JSON).
// Liefert KEINE IP-Adressen zurück – sie werden beim Parsen verworfen.

export type LogHit = {
  ts: Date;
  host: string | null;
  method: string;
  path: string;
  status: number;
  referer: string | null;
  ua: string;
};

// 1.2.3.4 - - [10/Oct/2026:13:55:36 +0200] "GET /pfad?x=1 HTTP/1.1" 200 2326 "https://ref/" "UA" [optional: host am Ende]
const COMBINED =
  /^\S+ \S+ \S+ \[([^\]]+)\] "([A-Z]+) (\S+)[^"]*" (\d{3}) \S+ "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"(?: "?([^"\s]+)"?)?/;

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** „10/Oct/2026:13:55:36 +0200“ → Date */
export function parseClfDate(s: string): Date | null {
  const m = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s.trim());
  if (!m || !MONTHS[m[2]]) return null;
  const d = new Date(`${m[3]}-${MONTHS[m[2]]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}${m[7]}${m[8]}:${m[9]}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const unescape = (s: string) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
const dash = (s: string | undefined) => (!s || s === "-" ? null : s);

function parseCombined(line: string): LogHit | null {
  const m = COMBINED.exec(line);
  if (!m) return null;
  const ts = parseClfDate(m[1]);
  if (!ts) return null;
  const host = dash(m[7]);
  return {
    ts,
    host: host && /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? host : null,
    method: m[2],
    path: m[3],
    status: Number(m[4]),
    referer: dash(unescape(m[5])),
    ua: unescape(m[6]),
  };
}

type CaddyLine = {
  ts?: number | string;
  status?: number;
  request?: { host?: string; uri?: string; method?: string; headers?: Record<string, string[] | string> };
};

function header(h: Record<string, string[] | string> | undefined, name: string): string | null {
  if (!h) return null;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = key ? h[key] : undefined;
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

function parseCaddy(line: string): LogHit | null {
  let j: CaddyLine;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  if (!j.request?.uri) return null;
  const ts = typeof j.ts === "number" ? new Date(j.ts * 1000) : j.ts ? new Date(j.ts) : null;
  if (!ts || Number.isNaN(ts.getTime())) return null;
  return {
    ts,
    host: j.request.host ?? null,
    method: j.request.method ?? "GET",
    path: j.request.uri,
    status: Number(j.status ?? 0),
    referer: header(j.request.headers, "referer"),
    ua: header(j.request.headers, "user-agent") ?? "",
  };
}

export function parseLogLine(line: string): LogHit | null {
  const t = line.trim();
  if (!t) return null;
  return t.startsWith("{") ? parseCaddy(t) : parseCombined(t);
}

// Statische Dateien sind für die Auswertung uninteressant (robots.txt, llms.txt, sitemap.xml bleiben drin)
const STATIC = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip)$/i;

export function isInterestingPath(path: string): boolean {
  const p = path.split("?")[0];
  if (p.startsWith("/_next/") || p.startsWith("/api/")) return false;
  return !STATIC.test(p);
}
