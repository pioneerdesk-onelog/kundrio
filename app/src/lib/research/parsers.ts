import { clipSnippet, hostOf } from "./names";
import type { RawHit } from "./types";

// Parser für GDELT DOC 2.0 (artlist JSON), SearXNG (JSON) und RSS/Atom – rein und testbar.

/** GDELT-Datum „20261007T081500Z“ → Date */
export function parseGdeltDate(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const LANG_MAP: Record<string, string> = { german: "de", english: "en", french: "fr", italian: "it", spanish: "es", dutch: "nl", polish: "pl" };

export function parseGdelt(json: unknown): RawHit[] {
  const arts = (json as { articles?: unknown })?.articles;
  if (!Array.isArray(arts)) return [];
  const out: RawHit[] = [];
  for (const a of arts) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url : null;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!url || !title) continue;
    const lang = typeof r.language === "string" ? r.language.toLowerCase() : null;
    out.push({
      url,
      title: title.slice(0, 500),
      snippet: null, // GDELT liefert keinen Auszug
      publishedAt: parseGdeltDate(r.seendate),
      sourceHost: typeof r.domain === "string" ? r.domain.toLowerCase().replace(/^www\./, "") : hostOf(url),
      sourceKind: "gdelt",
      language: lang ? (LANG_MAP[lang] ?? lang.slice(0, 5)) : null,
    });
  }
  return out;
}

function parseLooseDate(s: unknown): Date | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const d = new Date(s.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseSearxng(json: unknown): RawHit[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: RawHit[] = [];
  for (const x of results) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url : null;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!url || !title || !/^https?:\/\//i.test(url)) continue;
    out.push({
      url,
      title: title.slice(0, 500),
      snippet: clipSnippet(typeof r.content === "string" ? r.content : null),
      publishedAt: parseLooseDate(r.publishedDate ?? r.pubdate),
      sourceHost: hostOf(url),
      sourceKind: "searxng",
      language: null,
    });
  }
  return out;
}

// ---------- RSS/Atom ----------

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENT[n.toLowerCase()] ?? m);
}
function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function textOf(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  if (!m) return null;
  return decodeEntities(stripCdata(m[1]).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null;
}
function atomLink(entry: string): string | null {
  const links = Array.from(entry.matchAll(/<link\b([^>]*)\/?>/gi)).map((m) => m[1]);
  for (const attrs of links) {
    const rel = /\brel=["']([^"']+)["']/i.exec(attrs)?.[1];
    const href = /\bhref=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (href && (!rel || rel === "alternate")) return decodeEntities(href);
  }
  return null;
}

/** RSS 2.0 und Atom. Relative Links werden gegen `baseUrl` aufgelöst. */
export function parseFeed(xml: string, baseUrl?: string): RawHit[] {
  const out: RawHit[] = [];
  const isAtom = /<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(xml) || (/<entry\b/i.test(xml) && !/<item\b/i.test(xml));
  const blocks = isAtom ? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) : xml.match(/<item\b[\s\S]*?<\/item>/gi);
  for (const b of blocks ?? []) {
    const title = textOf(b, "title");
    let link = isAtom ? atomLink(b) : textOf(b, "link") ?? textOf(b, "guid");
    if (!title || !link) continue;
    try {
      link = new URL(link, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(link)) continue;
    const date = isAtom ? textOf(b, "published") ?? textOf(b, "updated") : textOf(b, "pubDate") ?? textOf(b, "dc:date");
    const desc = isAtom ? textOf(b, "summary") ?? textOf(b, "content") : textOf(b, "description");
    out.push({
      url: link,
      title: title.slice(0, 500),
      snippet: clipSnippet(desc),
      publishedAt: parseLooseDate(date),
      sourceHost: hostOf(link),
      sourceKind: "rss",
      language: null,
    });
  }
  return out;
}

/** Feed-Adressen aus <link rel="alternate" type="application/rss+xml|atom+xml"> einer HTML-Seite. */
export function discoverFeeds(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b([^>]+)>/gi)) {
    const a = m[1];
    if (!/rel=["']?alternate/i.test(a)) continue;
    if (!/type=["']application\/(rss|atom)\+xml["']/i.test(a)) continue;
    const href = /href=["']([^"']+)["']/i.exec(a)?.[1];
    if (!href) continue;
    try {
      out.push(new URL(decodeEntities(href), baseUrl).toString());
    } catch {
      /* ungültig */
    }
  }
  return Array.from(new Set(out)).slice(0, 3);
}

// Nur Übersichtsseiten (News-Segment am Pfadende), keine einzelnen Artikel
const NEWS_PATH = /\/(presse|pressemitteilungen|press|news|aktuelles|neuigkeiten|newsroom|blog|medien|media)(\/?|\/index\.html?|\.html?)$/i;

/** Links auf die Presse-/News-Übersicht der Firmen-Website (gleiche Domain). */
export function findNewsPages(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]), base);
      if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
      if (NEWS_PATH.test(u.pathname)) out.push(u.toString().split("#")[0]);
    } catch {
      /* ungültig */
    }
  }
  return Array.from(new Set(out)).slice(0, 2);
}

/**
 * Artikel-Links auf einer News-Übersicht: gleiche Domain, Pfad tiefer als die Übersicht, Linktext ≥ 20 Zeichen.
 * Dient als Ersatz, wenn die Website keinen Feed anbietet.
 */
export function extractArticleLinks(html: string, pageUrl: string, max = 15): RawHit[] {
  const page = new URL(pageUrl);
  const out: RawHit[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(decodeEntities(m[1]), page);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, "") !== page.hostname.replace(/^www\./, "")) continue;
    const pagePath = page.pathname.replace(/\/$/, "");
    if (!u.pathname.startsWith(pagePath + "/") || u.pathname.replace(/\/$/, "") === pagePath) continue;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text.length < 20 || /^(mehr|weiter|lesen|read more|weiterlesen)/i.test(text)) continue;
    const key = u.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: key, title: text.slice(0, 300), snippet: null, publishedAt: null, sourceHost: hostOf(key), sourceKind: "website", language: null });
    if (out.length >= max) break;
  }
  return out;
}
