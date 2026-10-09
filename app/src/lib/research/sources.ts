import "server-only";
import http from "node:http";
import https from "node:https";
import { searchTerms } from "./query";
import { discoverFeeds, extractArticleLinks, findNewsPages, parseFeed, parseGdelt, parseSearxng } from "./parsers";
import { safeFetchRaw } from "./fetch";
import type { RawHit, ResearchEntity } from "./types";

// Quellen: GDELT (offen), SearXNG (eigene Instanz), Presse-/News-Seite + Feed der Firmen-Website.
// Abhängigkeiten sind injizierbar (Tests gegen lokale Mock-Server).

export type FetchJson = (url: string) => Promise<unknown>;
export type FetchRaw = (url: string) => Promise<{ url: string; body: string }>;
export type SourceDeps = { fetchJson: FetchJson; fetchRaw: FetchRaw; gdeltBase: string; searxngBase: string };

/**
 * Fester, konfigurierter Endpunkt (GDELT/SearXNG) – keine Benutzereingabe. Über node:http(s) statt fetch,
 * weil GDELT oft > 10 s für den Verbindungsaufbau braucht (Standard-Connect-Timeout von fetch).
 */
const defaultFetchJson: FetchJson = (target) =>
  new Promise((resolve, reject) => {
    const u = new URL(target);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.get(u, { headers: { accept: "application/json", "user-agent": "Kundrio/0.1 (Recherche)" }, timeout: 30_000 }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (d: Buffer) => {
        size += d.length;
        if (size > 3_000_000) req.destroy(new Error("Antwort zu groß"));
        else chunks.push(d);
      });
      res.on("end", () => {
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        const text = Buffer.concat(chunks).toString("utf8");
        if (!text.trim()) return resolve({});
        try {
          resolve(JSON.parse(text));
        } catch {
          // GDELT antwortet bei ungültiger Abfrage mit Klartext
          reject(new Error(`Keine JSON-Antwort: ${text.slice(0, 120)}`));
        }
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung (30 s)")));
    req.on("error", reject);
  });

export function defaultDeps(): SourceDeps {
  return {
    fetchJson: defaultFetchJson,
    fetchRaw: (u) => safeFetchRaw(u),
    gdeltBase: process.env.GDELT_URL || "https://api.gdeltproject.org/api/v2/doc/doc",
    searxngBase: (process.env.SEARXNG_URL || "http://127.0.0.1:58080").replace(/\/$/, ""),
  };
}


// GDELT bittet um höchstens eine Anfrage je ~5 s
let lastGdelt = 0;
async function gdeltThrottle() {
  const wait = lastGdelt + 5_500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGdelt = Date.now();
}

export async function searchGdelt(e: ResearchEntity, deps: SourceDeps, opts: { timespan?: string; max?: number; throttle?: boolean } = {}): Promise<RawHit[]> {
  const terms = searchTerms(e);
  if (!terms.length) return [];
  // Eigene Website wird nach dem Abruf ausgefiltert (Domain-Ausschluss im Query ist bei GDELT fehleranfällig)
  const q = terms.length > 1 ? `(${terms.join(" OR ")})` : terms[0];
  const url = new URL(deps.gdeltBase);
  url.searchParams.set("query", q);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("maxrecords", String(Math.min(opts.max ?? 50, 250)));
  url.searchParams.set("timespan", opts.timespan ?? "3months");
  // GDELT drosselt hart (HTTP 429): bis zu zweimal mit wachsender Pause wiederholen
  for (let attempt = 0; ; attempt++) {
    if (opts.throttle !== false) await gdeltThrottle();
    try {
      return parseGdelt(await deps.fetchJson(url.toString()));
    } catch (e) {
      if (!/HTTP 429/.test(String(e)) || attempt >= 2 || opts.throttle === false) throw e;
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
    }
  }
}

export async function searchSearxng(e: ResearchEntity, deps: SourceDeps, opts: { categories?: string } = {}): Promise<RawHit[]> {
  const terms = searchTerms(e);
  const out: RawHit[] = [];
  for (const t of terms.slice(0, 2)) {
    const url = new URL(`${deps.searxngBase}/search`);
    url.searchParams.set("q", e.domain ? `${t} -site:${e.domain}` : t);
    url.searchParams.set("format", "json");
    url.searchParams.set("categories", opts.categories ?? "news");
    url.searchParams.set("language", "de");
    url.searchParams.set("safesearch", "1");
    out.push(...parseSearxng(await deps.fetchJson(url.toString())));
  }
  return out;
}

/** Feed bzw. Presse-Seite der Firmen-Website. */
export async function searchWebsite(e: ResearchEntity, deps: SourceDeps, website?: string | null): Promise<RawHit[]> {
  const start = website || (e.domain ? `https://${e.domain}` : null);
  if (!start || e.kind !== "company") return [];
  const home = await deps.fetchRaw(start);
  const hits: RawHit[] = [];
  const feeds = discoverFeeds(home.body, home.url);
  for (const f of feeds) {
    try {
      const feed = await deps.fetchRaw(f);
      hits.push(...parseFeed(feed.body, feed.url));
    } catch {
      /* Feed nicht erreichbar – weiter */
    }
  }
  if (hits.length === 0) {
    for (const p of findNewsPages(home.body, home.url)) {
      try {
        const page = await deps.fetchRaw(p);
        const pageFeeds = discoverFeeds(page.body, page.url);
        for (const f of pageFeeds) {
          try {
            const feed = await deps.fetchRaw(f);
            hits.push(...parseFeed(feed.body, feed.url));
          } catch {
            /* weiter */
          }
        }
        if (!pageFeeds.length) hits.push(...extractArticleLinks(page.body, page.url));
      } catch {
        /* weiter */
      }
    }
  }
  // Website-Treffer als Quelle „website“ führen (auch wenn per Feed gefunden, Art bleibt „rss“)
  return hits;
}
