// Impressum-Parser (deterministisch). Eingabe: Text des Impressums (htmlToText).
// Liefert nur, was eindeutig belegt ist; unsichere Felder bleiben leer.

export type ImpressumData = {
  legalName?: string;
  legalForm?: string;
  address?: string;
  phone?: string;
  email?: string;
  registerCourt?: string;
  registerNumber?: string;
  vatId?: string;
  managingDirectors?: string[];
};

const FORMS = [
  "GmbH & Co\\. KG",
  "GmbH & Co KG",
  "UG \\(haftungsbeschränkt\\)",
  "gGmbH",
  "GmbH",
  "AG & Co\\. KG",
  "SE",
  "AG",
  "KGaA",
  "OHG",
  "KG",
  "e\\. ?K\\.",
  "e\\. ?Kfm\\.",
  "e\\. ?V\\.",
  "eG",
  "PartG mbB",
  "PartG",
  "GbR",
];
const FORM_RE = new RegExp(`([A-ZÄÖÜ0-9][^\\n]{1,80}?\\s(${FORMS.join("|")}))(?=[\\s,.;]|$)`, "m");

const lines = (t: string) => t.split(/\n/).map((l) => l.trim()).filter(Boolean);

/** Deutsche USt-IdNr.: „DE“ + 9 Ziffern, Prüfziffer nach BZSt-Verfahren (ISO 7064 MOD 11,10). */
export function isValidGermanVatId(v: string): boolean {
  const m = v.replace(/\s/g, "").toUpperCase().match(/^DE(\d{9})$/);
  if (!m) return false;
  const d = m[1].split("").map(Number);
  let p = 10;
  for (let i = 0; i < 8; i++) {
    let s = (d[i] + p) % 10;
    if (s === 0) s = 10;
    p = (2 * s) % 11;
  }
  let check = 11 - p;
  if (check === 10) check = 0;
  return check === d[8];
}

/** USt-IdNr. im Text finden (DE mit Prüfziffer; andere EU-Länder nur nach Format). */
export function findVatId(text: string): string | undefined {
  const near = text.match(/(?:USt[\s.-]*Id[\s.-]*Nr\.?|Umsatzsteuer[- ]?Identifikationsnummer|VAT[\s-]*(?:ID|No\.?|number))[^A-Z0-9]{0,40}([A-Z]{2}\s?[0-9A-Z][0-9A-Z\s]{7,13})/i);
  const candidates = [near?.[1], ...Array.from(text.matchAll(/\bDE\s?\d{3}\s?\d{3}\s?\d{3}\b/g)).map((m) => m[0])].filter(Boolean) as string[];
  for (const c of candidates) {
    const v = c.replace(/\s/g, "").toUpperCase();
    if (v.startsWith("DE")) {
      if (isValidGermanVatId(v)) return v;
    } else if (/^(AT|BE|BG|CY|CZ|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|CH)U?[0-9A-Z]{8,12}$/.test(v)) {
      return v;
    }
  }
  return undefined;
}

function findRegister(text: string): { court?: string; number?: string } {
  const num = text.match(/\b(HR[AB])\s*(?:Nr\.?\s*)?(\d{2,7})(\s?[A-Z]{1,2})?\b/);
  const court =
    text.match(/(?:Registergericht|Handelsregister|eingetragen (?:im Handelsregister )?(?:beim|am)|Amtsgericht)[:\s]*(?:beim\s+|am\s+)?(Amtsgericht\s+[A-ZÄÖÜ][\wäöüß.-]+(?:[ -](?:am|an der|im|i\.\s?d\.)\s?[A-ZÄÖÜ][\wäöüß.-]+)?|AG\s+[A-ZÄÖÜ][\wäöüß-]+)/) ??
    text.match(/(Amtsgericht\s+[A-ZÄÖÜ][\wäöüß-]+(?:[ -](?:am|an der|im)\s?[A-ZÄÖÜ][\wäöüß-]+)?)/);
  return {
    number: num ? `${num[1]} ${num[2]}${num[3] ? num[3] : ""}`.trim() : undefined,
    court: court ? court[1].replace(/^AG\s+/, "Amtsgericht ").trim() : undefined,
  };
}

const NAME = "[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?(?:\\s+(?:von|van|de|zu|von der)\\s+)?(?:\\s+[A-ZÄÖÜ]\\.)?\\s+[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?";

function findDirectors(text: string): string[] {
  const m = text.match(
    /(?:Vertretungsberechtigte[r]?\s+Geschäftsführer(?:in|innen)?|Geschäftsführer(?:in|innen|ung)?|Geschäftsführende[r]?\s+Gesellschafter(?:in)?|Vertreten durch(?: die Geschäftsführer(?:in)?| den Vorstand| die Geschäftsführung)?|Vorstand|Inhaber(?:in)?|Managing Directors?|CEO)\s*[:\s]\s*([^\n]{3,200})/i,
  );
  if (!m) return [];
  const re = new RegExp(NAME, "g");
  const names = Array.from(m[1].matchAll(re)).map((x) => x[0].replace(/\s+/g, " ").trim());
  // Rollenwörter herausfiltern, die wie Namen aussehen
  return Array.from(new Set(names.filter((n) => !/^(Dr|Prof|Dipl|Herr|Frau|Amtsgericht|Registergericht)\b/.test(n)))).slice(0, 6);
}

function findPhone(text: string): string | undefined {
  const m = text.match(/(?:Tel(?:efon)?\.?|Phone|Fon)\s*[:.]?\s*(\+?[\d][\d\s/().-]{6,22}\d)/i);
  return m ? m[1].replace(/\s{2,}/g, " ").trim() : undefined;
}

function findEmail(text: string): string | undefined {
  const m = text.match(/(?:E-?Mail|Mail)\s*[:.]?\s*([A-Za-z0-9._%+-]+(?:@|\s?\[at\]\s?|\s?\(at\)\s?)[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i) ?? text.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
  return m ? m[1].replace(/\s?\[at\]\s?|\s?\(at\)\s?/i, "@").toLowerCase() : undefined;
}

/** Anschrift: Zeile mit Straße + Hausnummer, gefolgt von PLZ + Ort (in derselben oder der nächsten Zeile). */
function findAddress(ls: string[]): string | undefined {
  for (let i = 0; i < ls.length; i++) {
    const plzSame = ls[i].match(/^(.{3,80}?\s\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?),?\s+(\d{5}\s+[A-ZÄÖÜ][\wäöüß .()-]{1,40})$/);
    if (plzSame) return `${plzSame[1]}\n${plzSame[2].trim()}`;
    const plzNext = ls[i + 1]?.match(/^(?:D-)?(\d{5}\s+[A-ZÄÖÜ][\wäöüß .()-]{1,40})$/);
    if (plzNext && /\s\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?$/.test(ls[i]) && ls[i].length <= 80) return `${ls[i]}\n${plzNext[1].trim()}`;
    // Postfach
    if (plzNext && /^Postfach\s+\d+/i.test(ls[i])) return `${ls[i]}\n${plzNext[1].trim()}`;
  }
  return undefined;
}

export function parseImpressum(text: string): ImpressumData {
  const ls = lines(text);
  const out: ImpressumData = {};
  const form = text.match(FORM_RE);
  if (form) {
    out.legalName = form[1].replace(/^(Angaben gemäß § ?5 (TMG|DDG)|Anbieter|Herausgeber|Betreiber)[:\s]*/i, "").trim();
    out.legalForm = form[2].replace(/\\/g, "");
  }
  out.address = findAddress(ls);
  out.phone = findPhone(text);
  out.email = findEmail(text);
  const reg = findRegister(text);
  if (reg.number) out.registerNumber = reg.number;
  if (reg.court) out.registerCourt = reg.court;
  out.vatId = findVatId(text);
  const dirs = findDirectors(text);
  if (dirs.length) out.managingDirectors = dirs;
  for (const k of Object.keys(out) as (keyof ImpressumData)[]) if (out[k] === undefined) delete out[k];
  return out;
}
