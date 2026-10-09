import { companyNameVariants, hostOf, isSameSite } from "./names";
import type { RawHit, ResearchEntity } from "./types";

// Verwechslungsschutz (heuristisch, ohne KI): Betrifft der Treffer wirklich dieses Unternehmen/diese Person?

export type MatchResult = {
  /** 0–1: Wahrscheinlichkeit, dass der Treffer das gesuchte Unternehmen/die Person betrifft */
  score: number;
  reasons: string[];
  /** true = eigene Website des Unternehmens (keine Erwähnung durch Dritte) */
  ownSite: boolean;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

/** Wortgrenzen-Suche (kein Treffer für „Onelogistics“ bei „OneLog“). */
export function containsPhrase(text: string, phrase: string): boolean {
  const t = norm(text);
  const p = norm(phrase).trim();
  if (p.length < 3) return false;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9äöüß])${esc}($|[^a-z0-9äöüß])`, "i").test(t);
}

export function heuristicMatch(hit: RawHit, e: ResearchEntity): MatchResult {
  const reasons: string[] = [];
  const host = hit.sourceHost ?? hostOf(hit.url);
  const ownSite = isSameSite(host, e.domain);
  const text = `${hit.title} ${hit.snippet ?? ""}`;
  let score = 0;

  if (e.kind === "contact" && e.personName) {
    if (containsPhrase(text, e.personName)) {
      score += 0.45;
      reasons.push("Name der Person im Text");
    }
  }

  const variants = companyNameVariants(e.companyName);
  const full = variants[0];
  const short = variants[variants.length - 1];
  if (full && containsPhrase(text, full)) {
    score += e.kind === "contact" ? 0.3 : 0.55;
    reasons.push("vollständiger Firmenname im Text");
  } else if (short && containsPhrase(text, short)) {
    // Kurzname ohne Rechtsform ist mehrdeutiger
    const ambiguous = short.split(" ").length === 1 && short.length <= 6;
    score += ambiguous ? 0.25 : 0.4;
    reasons.push(ambiguous ? "Kurzname im Text (mehrdeutig)" : "Firmenname ohne Rechtsform im Text");
  }
  if (e.domain && (norm(text).includes(norm(e.domain)) || ownSite)) {
    score += 0.3;
    reasons.push(ownSite ? "eigene Website des Unternehmens" : "Domain im Text");
  }
  if (e.city && containsPhrase(text, e.city)) {
    score += 0.1;
    reasons.push(`Ort „${e.city}“ im Text`);
  }
  if (e.industry && containsPhrase(text, e.industry)) {
    score += 0.1;
    reasons.push("Branche im Text");
  }
  // Firmen-eigene Quellen (Website/RSS) betreffen das Unternehmen sicher
  if (hit.sourceKind === "website" || hit.sourceKind === "rss") {
    score = Math.max(score, 0.9);
    reasons.push("Quelle: Website/Feed des Unternehmens");
  }
  if (reasons.length === 0) reasons.push("kein Namensbezug im Titel/Auszug");
  return { score: Math.min(1, Math.round(score * 100) / 100), reasons, ownSite };
}
