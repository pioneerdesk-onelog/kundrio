import { companyNameVariants } from "./names";
import type { ResearchEntity } from "./types";

/** Suchbegriffe: Personen nur mit Firma (beruflicher Bezug), Unternehmen mit Name/Varianten. */
export function searchTerms(e: ResearchEntity): string[] {
  const variants = companyNameVariants(e.companyName);
  if (e.kind === "contact") {
    if (!e.personName || !variants.length) return [];
    return [`"${e.personName}" "${variants[variants.length - 1]}"`];
  }
  return variants.map((v) => `"${v}"`);
}
