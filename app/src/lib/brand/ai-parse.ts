import { aiGuideSchema, type AiGuide } from "./guide";
import type { Section } from "./extract";

// Reine Hilfen für die KI-Zusammenfassung (ohne Netz, testbar).

export const MAX_INPUT = 14_000;
const KEYWORDS = /(marke|brand|ton|tonalit|stimme|voice|sprache|schreib|anrede|duzen|siezen|gender|zielgruppe|logo|schutzraum|farbe|schrift|typo|do|don|nicht|bitte|stil)/i;

/** Relevante Abschnitte zuerst, gesamt begrenzt. */
export function selectSections(sections: Section[], max = MAX_INPUT): Section[] {
  const scored = sections.map((s, i) => ({ s, i, score: (s.text.match(new RegExp(KEYWORDS, "gi"))?.length ?? 0) }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const out: Section[] = [];
  let total = 0;
  for (const { s } of scored) {
    const text = s.text.slice(0, 3500);
    if (total + text.length > max) continue;
    out.push({ source: s.source, text });
    total += text.length;
  }
  return out;
}

export function parseAiGuide(raw: string, allowedSources: string[]): AiGuide {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("KI-Antwort enthielt kein JSON");
  const parsed = aiGuideSchema.parse(JSON.parse(json));
  // Nur Quellen zulassen, die wirklich übergeben wurden (keine erfundenen Belege)
  const ok = (src: string) => allowedSources.some((a) => a === src || a.startsWith(src) || src.startsWith(a));
  const keep = <T extends { source: string }>(arr: T[]) => arr.filter((x) => ok(x.source));
  return {
    voice: parsed.voice ? { ...parsed.voice, sources: parsed.voice.sources.filter(ok) } : null,
    do: keep(parsed.do),
    dont: keep(parsed.dont),
    audience: keep(parsed.audience),
    writingRules: { ...parsed.writingRules, notes: keep(parsed.writingRules.notes) },
    logoRules: keep(parsed.logoRules),
  };
}

