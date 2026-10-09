import type { RawHit } from "./types";

// Namensvarianten, URL-Normalisierung, Entdoppeln (rein, testbar).

const LEGAL_FORMS = [
  "gmbh & co\\. kgaa",
  "gmbh & co\\. kg",
  "gmbh & co kg",
  "ug \\(haftungsbeschränkt\\)",
  "ug \\(haftungsbeschraenkt\\)",
  "gmbh",
  "ggmbh",
  "ag",
  "kgaa",
  "kg",
  "ohg",
  "gbr",
  "e\\.k\\.",
  "e\\.kfm\\.",
  "e\\.v\\.",
  "eg",
  "se",
  "ug",
  "mbh",
  "ltd\\.?",
  "inc\\.?",
  "llc",
  "s\\.a\\.",
  "b\\.v\\.",
];
const LEGAL_RE = new RegExp(`[,\\s]+(${LEGAL_FORMS.join("|")})\\s*$`, "i");

/** „Muster Maschinenbau GmbH & Co. KG“ → „Muster Maschinenbau“ (mehrfach, falls verschachtelt). */
export function stripLegalForm(name: string): string {
  let n = name.trim().replace(/\s+/g, " ");
  for (let i = 0; i < 3; i++) {
    const next = n.replace(LEGAL_RE, "").trim();
    if (next === n) break;
    n = next;
  }
  return n;
}

/** Suchvarianten: voller Name und Name ohne Rechtsform (nur wenn aussagekräftig, ≥ 3 Zeichen). */
export function companyNameVariants(name: string | null | undefined): string[] {
  if (!name?.trim()) return [];
  const full = name.trim().replace(/\s+/g, " ");
  const short = stripLegalForm(full);
  return Array.from(new Set([full, short].filter((v) => v.length >= 3)));
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Domain-Vergleich inkl. Subdomains: news.firma.de gehört zu firma.de. */
export function isSameSite(host: string | null | undefined, domain: string | null | undefined): boolean {
  if (!host || !domain) return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|igshid$|_hs|mkt_tok$|cmpid$|wt_mc$)/i;

/** Für Entdoppeln/Speichern: Protokoll https, ohne www, ohne Tracking-Parameter, ohne Fragment und abschließenden Slash. */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  u.hash = "";
  u.username = "";
  u.password = "";
  for (const k of Array.from(u.searchParams.keys())) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  let s = u.toString();
  if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
  return s;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9äöüß]+/)
      .filter((t) => t.length >= 3),
  );
}

/** Jaccard-Ähnlichkeit zweier Titel (0–1). */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const SOURCE_RANK: Record<RawHit["sourceKind"], number> = { website: 0, rss: 1, gdelt: 2, searxng: 3 };

/**
 * Entdoppeln: gleiche normalisierte URL oder sehr ähnlicher Titel (≥ 0,8) gelten als derselbe Artikel
 * (z. B. Agenturmeldung auf mehreren Portalen). Behalten wird der Treffer mit Datum bzw. besserer Quelle.
 */
export function dedupeHits(hits: RawHit[], titleThreshold = 0.8): RawHit[] {
  const out: (RawHit & { _norm: string })[] = [];
  for (const h of hits) {
    const norm = normalizeUrl(h.url);
    if (!norm || !h.title?.trim()) continue;
    const dupIdx = out.findIndex((o) => o._norm === norm || titleSimilarity(o.title, h.title) >= titleThreshold);
    const candidate = { ...h, url: norm, _norm: norm };
    if (dupIdx === -1) {
      out.push(candidate);
      continue;
    }
    const prev = out[dupIdx];
    const better =
      (!prev.publishedAt && h.publishedAt) ||
      (Boolean(prev.publishedAt) === Boolean(h.publishedAt) && SOURCE_RANK[h.sourceKind] < SOURCE_RANK[prev.sourceKind]);
    if (better) out[dupIdx] = { ...candidate, snippet: candidate.snippet ?? prev.snippet };
    else if (!prev.snippet && h.snippet) prev.snippet = h.snippet;
  }
  return out.map(({ _norm, ...rest }) => {
    void _norm;
    return rest;
  });
}

/** Snippet kürzen (Urheberrecht: nur kurze Auszüge, keine Volltexte). */
export function clipSnippet(s: string | null | undefined, max = 300): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
}
