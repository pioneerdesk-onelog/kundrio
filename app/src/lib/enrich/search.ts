import "server-only";
import { enrichConfig } from "./config";

// Websuche über die eigene SearXNG-Instanz (konfigurierter, vertrauenswürdiger Endpunkt).
// Gesendet wird nur der Suchbegriff; SearXNG leitet ihn an die konfigurierten Suchdienste weiter.

export type SearchResult = { url: string; title: string; content: string; engine?: string };

export async function webSearch(query: string, opts: { limit?: number; language?: string } = {}): Promise<SearchResult[]> {
  const base = enrichConfig.searxUrl();
  if (!base) return [];
  const u = new URL(`${base}/search`);
  u.searchParams.set("q", query.slice(0, 300));
  u.searchParams.set("format", "json");
  u.searchParams.set("language", opts.language ?? "de");
  u.searchParams.set("safesearch", "1");
  const engines = enrichConfig.searxEngines();
  if (engines) u.searchParams.set("engines", engines);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(u, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Suche nicht erreichbar (HTTP ${res.status})`);
    const data = (await res.json()) as { results?: { url?: string; title?: string; content?: string; engine?: string }[] };
    return (data.results ?? [])
      .filter((r) => typeof r.url === "string" && /^https?:\/\//.test(r.url))
      .slice(0, opts.limit ?? 10)
      .map((r) => ({ url: r.url!, title: (r.title ?? "").slice(0, 300), content: (r.content ?? "").slice(0, 600), engine: r.engine }));
  } finally {
    clearTimeout(t);
  }
}
