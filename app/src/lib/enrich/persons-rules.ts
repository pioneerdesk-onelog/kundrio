import { OPT_OUT_TAG } from "./config";
import { professionalProfileNet } from "./links";

// Regeln der Personen-Anreicherung (ADR-016): nur beruflich, nur mit Einstellung, Widerspruch per Tag.

/** Grund, warum ein Kontakt nicht angereichert werden darf – oder null. */
export function personEnrichmentBlocked(ws: { enrichPersons: boolean }, contact: { tags: string[] }): string | null {
  if (!ws.enrichPersons) return "Die Anreicherung von Personen ist in diesem Sub-Account ausgeschaltet.";
  if (contact.tags.map((t) => t.toLowerCase()).includes(OPT_OUT_TAG)) return "Der Kontakt hat der Anreicherung widersprochen (Tag „keine-anreicherung“).";
  return null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Kernname einer Firma ohne Rechtsform (für den Abgleich in Suchtreffern). */
export function companyCore(name: string): string {
  return norm(name)
    .replace(/\b(gmbh|co|kg|ag|se|ug|haftungsbeschrankt|e k|ek|ohg|gbr|mbh|kgaa|partg|mbb|ev|eg)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Suchtreffer als berufliches Profil des Kontakts akzeptieren? Nur LinkedIn-/XING-Personenprofile,
 * deren Titel/Text Vor- UND Nachname sowie den Firmennamen enthält. Inhalte werden nie abgerufen.
 */
export function matchProfileResult(
  r: { url: string; title: string; content?: string },
  p: { firstName?: string | null; lastName?: string | null; company?: string | null },
): "linkedin" | "xing" | null {
  const net = professionalProfileNet(r.url);
  if (!net || !p.firstName || !p.lastName || !p.company) return null;
  const hay = norm(`${r.title} ${r.content ?? ""}`);
  const core = companyCore(p.company);
  if (!core) return null;
  return hay.includes(norm(p.firstName)) && hay.includes(norm(p.lastName)) && hay.includes(core) ? net : null;
}

const TITLE_WORDS =
  /(geschäftsführer(?:in)?|gesch[äa]ftsleitung|inhaber(?:in)?|gründer(?:in)?|co-?founder|founder|vorstand(?:svorsitzende[r]?)?|prokurist(?:in)?|ceo|cto|cfo|coo|cmo|head of [a-z ]+|leiter(?:in)? [a-zäöüß -]+|leitung [a-zäöüß -]+|bereichsleiter(?:in)?|abteilungsleiter(?:in)?|vertrieb[a-zäöüß ]*|marketing[a-zäöüß ]*|einkauf|personal|hr|it-leiter(?:in)?|projektleiter(?:in)?|key account manager(?:in)?|account manager(?:in)?|sales manager(?:in)?|assistenz der geschäftsführung|büroleitung)/i;

/** Funktion einer Person aus Team-/Impressum-Text: gleiche Zeile nach Trennzeichen oder nächste Zeile. */
export function jobTitleFromText(text: string, firstName: string, lastName: string): string | undefined {
  const ls = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const full = `${firstName} ${lastName}`.toLowerCase();
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    const idx = l.toLowerCase().indexOf(full);
    if (idx < 0) continue;
    const rest = l.slice(idx + full.length).replace(/^[\s,–—\-|:/]+/, "").trim();
    const candidates = [rest, ls[i + 1] ?? "", l.slice(0, idx).replace(/[\s,–—\-|:/]+$/, "").trim()];
    for (const c of candidates) {
      if (c && c.length <= 60 && TITLE_WORDS.test(c)) return c.replace(/\s+/g, " ").trim();
    }
  }
  return undefined;
}
