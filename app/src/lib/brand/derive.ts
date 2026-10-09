import { contrastRatio } from "../p-a11y";
import { findColors, findFonts, findSpotColors, isNeutral, type FoundColor } from "./colors";
import type { Section } from "./extract";
import type { AiGuide, SuggestionField } from "./guide";

// Reine Ableitung von Vorschlägen aus erkanntem Text bzw. KI-Ergebnis (ohne DB/Netz, testbar).

export type BrandSourceKind = "brandbook" | "website" | "manual";
export type NewSuggestion = { field: SuggestionField; value: unknown; sourceUrl?: string | null; sourceKind: BrandSourceKind; confidence?: number };

export const colorInfo = (hex: string, reason: string) => ({ hex: hex.toUpperCase(), reason, contrastWhite: Number((contrastRatio(hex, "#ffffff") ?? 0).toFixed(2)) });

function roleOf(c: FoundColor): "primary" | "accent" | "secondary" | "neutral" | "other" {
  const l = (c.label ?? "").toLowerCase();
  if (/(primär|primaer|primary|hauptfarbe|haupt)/.test(l)) return "primary";
  if (/(akzent|accent|highlight)/.test(l)) return "accent";
  if (/(sekundär|sekundaer|secondary)/.test(l)) return "secondary";
  if (/(grau|grey|gray|weiß|weiss|white|schwarz|black|neutral)/.test(l) || isNeutral(c.hex)) return "neutral";
  return "other";
}

/** Vorschläge aus erkannten Farben/Schriften eines Texts (Brandbook). Exportiert für Tests. */
export function suggestionsFromText(sections: Section[], sourceKind: BrandSourceKind, sourceRef: string): NewSuggestion[] {
  const all = sections.map((s) => s.text).join("\n");
  const out: NewSuggestion[] = [];
  const colors = findColors(all).slice(0, 16);
  if (colors.length) {
    out.push({
      field: "guide.colors",
      sourceKind,
      sourceUrl: sourceRef,
      confidence: 0.9,
      value: { data: colors.slice(0, 12).map((c) => ({ name: c.label ?? "", hex: c.hex, role: roleOf(c), source: sourceRef, approx: c.approx })) },
    });
    const primary = colors.find((c) => roleOf(c) === "primary") ?? colors.find((c) => !isNeutral(c.hex));
    if (primary) out.push({ field: "brandPrimary", sourceKind, sourceUrl: sourceRef, confidence: roleOf(primary) === "primary" ? 0.9 : 0.6, value: colorInfo(primary.hex, primary.label ? `„${primary.label}“ (${primary.raw})` : `häufigste Markenfarbe (${primary.raw})`) });
    const accent = colors.find((c) => roleOf(c) === "accent") ?? colors.find((c) => c !== primary && !isNeutral(c.hex));
    if (accent) out.push({ field: "brandAccent", sourceKind, sourceUrl: sourceRef, confidence: roleOf(accent) === "accent" ? 0.85 : 0.5, value: colorInfo(accent.hex, accent.label ? `„${accent.label}“ (${accent.raw})` : `weitere Markenfarbe (${accent.raw})`) });
  }
  const spot = findSpotColors(all);
  if (spot.length) out.push({ field: "guide.spotColors", sourceKind, sourceUrl: sourceRef, confidence: 0.9, value: { data: spot } });
  const fonts = findFonts(all);
  if (fonts.length) {
    out.push({ field: "fontHeading", sourceKind, sourceUrl: sourceRef, confidence: 0.6, value: { font: fonts[0] } });
    out.push({ field: "fontBody", sourceKind, sourceUrl: sourceRef, confidence: 0.5, value: { font: fonts[1] ?? fonts[0] } });
    out.push({ field: "guide.typography", sourceKind, sourceUrl: sourceRef, confidence: 0.7, value: { data: { heading: fonts[0], body: fonts[1] ?? fonts[0], others: fonts.slice(2), googleFonts: [], source: sourceRef } } });
  }
  return out;
}

export function suggestionsFromAi(ai: AiGuide, sourceKind: BrandSourceKind, sourceRef: string): NewSuggestion[] {
  const out: NewSuggestion[] = [];
  const base = { sourceKind, sourceUrl: sourceRef, confidence: 0.7 };
  if (ai.voice?.summary) out.push({ ...base, field: "guide.voice", value: { data: ai.voice } });
  if (ai.do.length || ai.dont.length) out.push({ ...base, field: "guide.doAndDont", value: { data: { do: ai.do, dont: ai.dont } } });
  if (ai.audience.length) out.push({ ...base, field: "guide.audience", value: { data: ai.audience } });
  if (ai.writingRules.address !== "unklar" || ai.writingRules.gender || ai.writingRules.terms.length || ai.writingRules.notes.length) {
    out.push({ ...base, field: "guide.writingRules", value: { data: { ...ai.writingRules, gender: ai.writingRules.gender ?? undefined } } });
  }
  if (ai.logoRules.length) out.push({ ...base, field: "guide.logoRules", value: { data: ai.logoRules } });
  return out;
}

