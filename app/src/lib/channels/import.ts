// Import von Plattform-Exporten (CSV) als Rückfall ohne API – kein Lock-in.
// Nur CSV: Die verbreitete Bibliothek `xlsx` (SheetJS, npm-Version) hat bekannte, ungepatchte Sicherheitslücken
// (Prototype Pollution/ReDoS); `exceljs` wäre groß und ohne Nutzen, weil alle Plattformen CSV-Export bzw. „Als CSV speichern“ erlauben.
// Rein (testbar).
import { createHash } from "node:crypto";
import { parseCsv } from "../a-csv";
import type { PostInput } from "./types";

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

export type MetricField = "skip" | "date" | "followers" | "views" | "posts";
export type PostField = "skip" | "id" | "url" | "title" | "publishedAt" | "impressions" | "views" | "likes" | "comments" | "shares" | "clicks";
export type ImportKind = "metrics" | "posts";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß%]+/g, " ").trim();

const METRIC_ALIASES: Record<Exclude<MetricField, "skip">, string[]> = {
  date: ["date", "datum", "day", "tag"],
  followers: ["total followers", "followers", "follower", "gesamtzahl follower", "follower gesamt", "abonnenten", "subscribers", "fans", "page likes", "facebook page likes", "seiten follower", "instagram follower", "follows"],
  views: ["impressions", "impressionen", "total impressions", "views", "aufrufe", "reach", "reichweite", "page views", "seitenaufrufe", "content views"],
  posts: ["posts", "beiträge", "tweets", "updates"],
};

const POST_ALIASES: Record<Exclude<PostField, "skip">, string[]> = {
  id: ["tweet id", "post id", "update id", "beitrags id", "post-id", "id", "media id"],
  url: ["tweet permalink", "post link", "permalink", "update link", "url", "link", "beitragslink"],
  title: ["tweet text", "text", "post title", "update title", "beschreibung", "description", "title", "titel", "caption"],
  publishedAt: ["time", "created date", "publish time", "veröffentlicht", "veröffentlichungszeit", "erstellt", "date", "datum", "published"],
  impressions: ["impressions", "impressionen"],
  views: ["views", "aufrufe", "video views", "plays"],
  likes: ["likes", "reactions", "reaktionen", "gefällt mir", "like count"],
  comments: ["comments", "kommentare", "replies", "antworten"],
  shares: ["shares", "reposts", "retweets", "geteilt", "teilungen"],
  clicks: ["clicks", "klicks", "url clicks", "link clicks"],
};

function matchExact(header: string, aliases: Record<string, string[]>, used: Set<string>): string | null {
  const h = norm(header);
  for (const [field, list] of Object.entries(aliases)) if (!used.has(field) && list.some((a) => norm(a) === h)) return field;
  return null;
}

function matchPartial(header: string, aliases: Record<string, string[]>, used: Set<string>): string | null {
  const h = norm(header);
  for (const [field, list] of Object.entries(aliases)) if (!used.has(field) && list.some((a) => h.startsWith(norm(a)) || h.includes(` ${norm(a)}`))) return field;
  return null;
}

/** Erkennt, ob die Datei Tageswerte oder Beiträge enthält. */
export function detectKind(header: string[]): ImportKind {
  const h = header.map(norm);
  const postish = h.some((c) => /tweet|post|update|permalink|beitrag|media|caption/.test(c));
  return postish ? "posts" : "metrics";
}

export function suggestMapping(header: string[], kind: ImportKind): string[] {
  const aliases = kind === "metrics" ? METRIC_ALIASES : POST_ALIASES;
  const used = new Set<string>();
  const out: string[] = header.map(() => "skip");
  // 1. Durchlauf: exakte Treffer über alle Spalten (z. B. „Total followers“ vor „Organic followers“)
  header.forEach((col, i) => {
    const f = matchExact(col, aliases, used);
    if (f) {
      out[i] = f;
      used.add(f);
    }
  });
  // 2. Durchlauf: Teiltreffer für die übrigen Spalten
  header.forEach((col, i) => {
    if (out[i] !== "skip") return;
    const f = matchPartial(col, aliases, used);
    if (f) {
      out[i] = f;
      used.add(f);
    }
  });
  return out;
}

/** Zahl aus deutschem/englischem Format: „1.234“, „1,234“, „1.234,5“, „12 %“ (Prozent → Anteil). */
export function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim().replace(/\s/g, "");
  if (!s || s === "-" || s === "–") return null;
  const pct = s.endsWith("%");
  s = s.replace(/%$/, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

/** Datum: ISO, „TT.MM.JJJJ“, „MM/TT/JJJJ“ (LinkedIn/X-Exporte), „JJJJ-MM-TT hh:mm +0000“. */
export function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type ParsedExport = { header: string[]; rows: string[][]; kind: ImportKind; mapping: string[] };

export function parseExport(text: string): ParsedExport {
  if (Buffer.byteLength(text, "utf8") > IMPORT_MAX_BYTES) throw new Error("Datei ist größer als 2 MB.");
  const all = parseCsv(text);
  if (all.length < 2) throw new Error("Datei enthält keine Datenzeilen.");
  // Manche Exporte haben Vorzeilen (Titel/Zeitraum) – Kopfzeile = erste Zeile mit ≥ 2 nicht-leeren Zellen, der eine gleich breite Zeile folgt
  let hi = 0;
  while (hi < Math.min(all.length - 1, 10) && !(all[hi].filter((c) => c.trim()).length >= 2 && all[hi + 1]?.length === all[hi].length)) hi++;
  const header = all[hi].map((h) => h.trim());
  const rows = all.slice(hi + 1, hi + 1 + IMPORT_MAX_ROWS);
  const kind = detectKind(header);
  return { header, rows, kind, mapping: suggestMapping(header, kind) };
}

export type MetricRow = { date: Date; followers: number | null; views: number | null; posts: number | null };

export function toMetricRows(rows: string[][], mapping: string[]): MetricRow[] {
  const col = (f: MetricField) => mapping.indexOf(f);
  if (col("date") < 0) throw new Error("Spalte „Datum“ fehlt in der Zuordnung.");
  const byDay = new Map<string, MetricRow>();
  for (const r of rows) {
    const date = parseDate(r[col("date")]);
    if (!date) continue;
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const get = (f: MetricField) => (col(f) >= 0 ? parseNumber(r[col(f)]) : null);
    byDay.set(day.toISOString(), { date: day, followers: get("followers"), views: get("views"), posts: get("posts") });
  }
  return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function toPostRows(rows: string[][], mapping: string[]): PostInput[] {
  const col = (f: PostField) => mapping.indexOf(f);
  const cell = (r: string[], f: PostField) => (col(f) >= 0 ? (r[col(f)] ?? "").trim() : "");
  const numOf = (r: string[], f: PostField) => (col(f) >= 0 ? parseNumber(r[col(f)]) : null);
  const out = new Map<string, PostInput>();
  for (const r of rows) {
    const url = cell(r, "url");
    const title = cell(r, "title");
    const publishedAt = parseDate(cell(r, "publishedAt"));
    let id = cell(r, "id") || url;
    if (!id) {
      if (!title && !publishedAt) continue;
      id = `import:${createHash("sha256").update(`${title}|${publishedAt?.toISOString() ?? ""}`).digest("hex").slice(0, 24)}`;
    }
    out.set(id, {
      externalId: id.slice(0, 300),
      url: /^https?:\/\//.test(url) ? url.slice(0, 1000) : null,
      title: title ? (title.length > 140 ? `${title.slice(0, 139)}…` : title) : null,
      publishedAt,
      metrics: { impressions: numOf(r, "impressions"), views: numOf(r, "views"), likes: numOf(r, "likes"), comments: numOf(r, "comments"), shares: numOf(r, "shares"), clicks: numOf(r, "clicks") },
    });
  }
  return [...out.values()];
}

export const METRIC_FIELD_LABELS: Record<MetricField, string> = { skip: "– ignorieren –", date: "Datum", followers: "Follower", views: "Aufrufe/Impressionen", posts: "Beiträge" };
export const POST_FIELD_LABELS: Record<PostField, string> = {
  skip: "– ignorieren –",
  id: "Beitrags-ID",
  url: "Link",
  title: "Text/Titel",
  publishedAt: "Datum",
  impressions: "Impressionen",
  views: "Aufrufe",
  likes: "Likes/Reaktionen",
  comments: "Kommentare",
  shares: "Geteilt/Reposts",
  clicks: "Klicks",
};
