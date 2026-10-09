import type { Analysis } from "./analyze-schema";

/** Schwellen: automatisch „relevant“ nur bei sicherer Zuordnung und hoher Bedeutung. */
export function decideStatus(match: number, a: Analysis | null): { status: "new" | "relevant" | "irrelevant"; uncertain: boolean } {
  if (a) {
    if (!a.aboutEntity && a.confidence >= 0.7) return { status: "irrelevant", uncertain: false };
    const sure = a.aboutEntity && a.confidence >= 0.7 && match >= 0.4;
    if (sure && a.relevance >= 0.6) return { status: "relevant", uncertain: false };
    return { status: "new", uncertain: !sure };
  }
  return { status: "new", uncertain: match < 0.5 };
}
