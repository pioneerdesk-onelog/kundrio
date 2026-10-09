import type { BrandGuide } from "./guide";

// Markenstimme als Text (rein, testbar). Nutzung: voice.ts → brandVoicePrompt().

export function voiceFromGuide(g: BrandGuide): string | null {
  const parts: string[] = [];
  if (g.voice?.summary) parts.push(`Markenstimme: ${g.voice.summary}${g.voice.adjectives.length ? ` (${g.voice.adjectives.join(", ")})` : ""}`);
  const w = g.writingRules;
  if (w) {
    if (w.address !== "unklar") parts.push(`Anrede: ${w.address === "du" ? "Du" : "Sie"}`);
    if (w.gender) parts.push(`Gendern: ${w.gender}`);
    if (w.terms.length) parts.push(`Begriffe/Schreibweisen: ${w.terms.slice(0, 15).join(", ")}`);
  }
  if (g.doAndDont?.do.length) parts.push(`Bitte: ${g.doAndDont.do.slice(0, 6).map((d) => d.text).join("; ")}`);
  if (g.doAndDont?.dont.length) parts.push(`Vermeiden: ${g.doAndDont.dont.slice(0, 6).map((d) => d.text).join("; ")}`);
  if (!parts.length) return null;
  return `Stilvorgaben aus dem Markenleitfaden (nur für Ton und Stil, keine Fakten):\n- ${parts.join("\n- ")}`.slice(0, 1800);
}

