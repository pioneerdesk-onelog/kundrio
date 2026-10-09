import { z } from "zod";
import type { DocKind } from "../invoice";

// Personalisierbare Dokumenttexte (Angebot, Auftragsbestätigung, Rechnung) – client- und serverseitig nutzbar.
// Platzhalter: {{ kunde.name }}, {{ dokument.nummer }}, {{ absender.firma }} … optional {{ x.y | default: "…" }}.
// Bewusst keine Template-Sprache: nur Werte-Ersetzung, im HTML wird jeder Wert escaped.

export const TEXT_FIELDS = ["intro", "outro", "paymentTerms", "emailSubject", "emailBody"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
export const TEXT_FIELD_LABEL: Record<TextField, string> = {
  intro: "Einleitung (über den Positionen)",
  outro: "Schlusstext (unter den Positionen)",
  paymentTerms: "Zahlungsbedingungen",
  emailSubject: "E-Mail-Betreff",
  emailBody: "E-Mail-Text",
};

export type DocTexts = Record<TextField, string>;
export type DocumentTexts = Record<DocKind, DocTexts>;

const textSchema = z.object({
  intro: z.string().max(4000),
  outro: z.string().max(4000),
  paymentTerms: z.string().max(1000),
  emailSubject: z.string().max(300),
  emailBody: z.string().max(8000),
});
export const docTextsSchema = textSchema;

/** Vorbelegte Standardtexte (gutes, schlichtes Deutsch, Sie-Form). */
export const DEFAULT_TEXTS: DocumentTexts = {
  QUOTE: {
    intro: "Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihr Interesse. Gerne unterbreiten wir Ihnen folgendes Angebot:",
    outro: "Dieses Angebot ist gültig bis {{ dokument.gueltig_bis }}. Wir freuen uns auf Ihren Auftrag und stehen für Rückfragen jederzeit zur Verfügung.\n\nMit freundlichen Grüßen\n{{ absender.ansprechpartner }}\n{{ absender.firma }}",
    paymentTerms: "Zahlbar innerhalb von 14 Tagen nach Rechnungsstellung ohne Abzug.",
    emailSubject: "Ihr Angebot {{ dokument.nummer }} von {{ absender.firma }}",
    emailBody: "Guten Tag {{ kunde.ansprechpartner | default: \"\" }},\n\nanbei erhalten Sie unser Angebot {{ dokument.nummer }} über {{ dokument.summe_brutto }} (gültig bis {{ dokument.gueltig_bis }}).\n\n{{ dokument.annahme_link }}\n\nBei Fragen melden Sie sich gerne.\n\nMit freundlichen Grüßen\n{{ absender.ansprechpartner }}\n{{ absender.firma }}",
  },
  ORDER: {
    intro: "Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihren Auftrag{{ dokument.kundenreferenz_text }}. Hiermit bestätigen wir Ihnen verbindlich die folgenden Leistungen:",
    outro: "Leistungszeitraum: {{ dokument.leistungszeitraum }}.\n\nWir freuen uns auf die Zusammenarbeit. Bei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{{ absender.ansprechpartner }}\n{{ absender.firma }}",
    paymentTerms: "Die Abrechnung erfolgt nach Leistungserbringung. Zahlbar innerhalb von 14 Tagen ohne Abzug.",
    emailSubject: "Auftragsbestätigung {{ dokument.nummer }} – {{ absender.firma }}",
    emailBody: "Guten Tag {{ kunde.ansprechpartner | default: \"\" }},\n\nvielen Dank für Ihren Auftrag. Anbei erhalten Sie unsere Auftragsbestätigung {{ dokument.nummer }} über {{ dokument.summe_brutto }}.\n\nMit freundlichen Grüßen\n{{ absender.ansprechpartner }}\n{{ absender.firma }}",
  },
  INVOICE: {
    intro: "Sehr geehrte Damen und Herren,\n\nfür unsere Leistungen erlauben wir uns, Ihnen Folgendes in Rechnung zu stellen:",
    outro: "Vielen Dank für Ihren Auftrag und die gute Zusammenarbeit.\n\nMit freundlichen Grüßen\n{{ absender.ansprechpartner }}\n{{ absender.firma }}",
    paymentTerms: "Bitte überweisen Sie den Betrag von {{ dokument.summe_brutto }} bis {{ dokument.faellig_am }} unter Angabe der Rechnungsnummer {{ dokument.nummer }}.{{ dokument.zahlungslink_text }}",
    emailSubject: "Rechnung {{ dokument.nummer }} von {{ absender.firma }}",
    emailBody: "Guten Tag {{ kunde.ansprechpartner | default: \"\" }},\n\nanbei erhalten Sie unsere Rechnung {{ dokument.nummer }} über {{ dokument.summe_brutto }}, fällig am {{ dokument.faellig_am }}.{{ dokument.zahlungslink_text }}\n\nVielen Dank für Ihren Auftrag.\n\nMit freundlichen Grüßen\n{{ absender.ansprechpartner }}\n{{ absender.firma }}",
  },
};

/** Gespeicherte Texte eines Sub-Accounts mit Standardwerten zusammenführen (fehlende/leere Felder = Standard). */
export function resolveTexts(stored: unknown): DocumentTexts {
  const v = (stored && typeof stored === "object" ? stored : {}) as Partial<Record<DocKind, Partial<DocTexts>>>;
  const out = {} as DocumentTexts;
  for (const kind of Object.keys(DEFAULT_TEXTS) as DocKind[]) {
    const src = v[kind] ?? {};
    out[kind] = {} as DocTexts;
    for (const f of TEXT_FIELDS) {
      const val = src[f];
      out[kind][f] = typeof val === "string" && val.trim() ? val : DEFAULT_TEXTS[kind][f];
    }
  }
  return out;
}

// ---------- Platzhalter ----------

export type PlaceholderDef = { key: string; label: string };
export const PLACEHOLDERS: { group: string; items: PlaceholderDef[] }[] = [
  {
    group: "Kunde",
    items: [
      { key: "kunde.name", label: "Name/Firma des Empfängers" },
      { key: "kunde.firma", label: "Firma" },
      { key: "kunde.ansprechpartner", label: "Ansprechpartner (Vor- und Nachname)" },
      { key: "kunde.vorname", label: "Vorname" },
      { key: "kunde.nachname", label: "Nachname" },
    ],
  },
  {
    group: "Dokument",
    items: [
      { key: "dokument.art", label: "Belegart" },
      { key: "dokument.nummer", label: "Nummer" },
      { key: "dokument.datum", label: "Datum" },
      { key: "dokument.summe_netto", label: "Summe netto" },
      { key: "dokument.summe_brutto", label: "Summe brutto" },
      { key: "dokument.gueltig_bis", label: "Gültig bis (Angebot)" },
      { key: "dokument.faellig_am", label: "Fällig am (Rechnung)" },
      { key: "dokument.leistungszeitraum", label: "Leistungszeitraum" },
      { key: "dokument.kundenreferenz", label: "Ihre Bestell-/Referenznummer" },
      { key: "dokument.kundenreferenz_text", label: "„(Ihre Bestellung …)“ – nur wenn vorhanden" },
      { key: "dokument.annahme_link", label: "Link zur Online-Annahme (nur Angebot, nur E-Mail)" },
      { key: "dokument.zahlungslink", label: "Bezahllink (nur Rechnung, nur mit verbundenem Zahlungsanbieter)" },
      { key: "dokument.zahlungslink_text", label: "„Online bezahlen: …“ – nur wenn ein Bezahllink vorhanden ist" },
      { key: "invoice.paymentLink", label: "Bezahllink (gleich wie dokument.zahlungslink, HubSpot/Brevo-Schreibweise)" },
    ],
  },
  {
    group: "Absender",
    items: [
      { key: "absender.firma", label: "Firmenname" },
      { key: "absender.ansprechpartner", label: "Ansprechpartner (angemeldeter Benutzer)" },
      { key: "absender.email", label: "E-Mail" },
      { key: "absender.telefon", label: "Telefon" },
    ],
  },
];

export type DocContext = { kunde: Record<string, string>; dokument: Record<string, string>; absender: Record<string, string> };

const PLACEHOLDER = /\{\{\s*(kunde|dokument|absender)\.([a-z_]+)\s*(?:\|\s*default\s*:\s*(?:"([^"]*)"|'([^']*)'))?\s*\}\}/g;

export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Alias in HubSpot/Brevo-Schreibweise (Zahlungsmodul): {{ invoice.paymentLink }} = {{ dokument.zahlungslink }}
const PAYMENT_LINK_ALIAS = /\{\{\s*invoice\.paymentLink\s*(\|[^}]*)?\}\}/g;

/** Platzhalter ersetzen. Unbekannte Platzhalter werden leer bzw. durch den Standardwert ersetzt. */
export function renderDocText(input: string, ctx: DocContext, opts: { html?: boolean } = {}): string {
  return input.replace(PAYMENT_LINK_ALIAS, (_m, def?: string) => `{{ dokument.zahlungslink ${def ?? ""}}}`).replace(PLACEHOLDER, (_m, root: keyof DocContext, key: string, defDq?: string, defSq?: string) => {
    const raw = ctx[root]?.[key];
    const value = raw === undefined || raw === null || raw === "" ? (defDq ?? defSq ?? "") : String(raw);
    return opts.html ? escapeHtmlText(value) : value;
  });
}

/** Platzhalter, die im Text vorkommen, aber unbekannt sind (Hinweis im Editor). */
export function unknownPlaceholders(input: string): string[] {
  const known = new Set(PLACEHOLDERS.flatMap((g) => g.items.map((i) => i.key)));
  const out = new Set<string>();
  for (const m of input.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)) {
    const k = m[1].trim();
    if (!known.has(k)) out.add(k);
  }
  return [...out];
}

// ---------- Kontext aus Daten ----------

const eur = (cents: number, currency = "EUR") => new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);
const day = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" }).format(d) : "");

export type DocLike = {
  kind: string;
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  serviceFrom: Date | null;
  serviceTo: Date | null;
  netCents: number;
  grossCents: number;
  currency: string;
  buyerName: string | null;
  customerOrderRef: string | null;
};
export type ContactLike = { firstName: string | null; lastName: string | null; company: string | null } | null;
export type SenderLike = { companyName: string; userName?: string | null; email?: string | null; phone?: string | null };

export function buildDocContext(doc: DocLike, contact: ContactLike, sender: SenderLike, extra: { acceptUrl?: string | null; paymentUrl?: string | null } = {}): DocContext {
  const person = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ");
  const period =
    doc.serviceFrom && doc.serviceTo ? `${day(doc.serviceFrom)} – ${day(doc.serviceTo)}` : day(doc.serviceFrom ?? doc.issueDate);
  const kindLabel = doc.kind === "QUOTE" ? "Angebot" : doc.kind === "ORDER" ? "Auftragsbestätigung" : "Rechnung";
  return {
    kunde: {
      name: doc.buyerName ?? (contact?.company || person),
      firma: contact?.company ?? doc.buyerName ?? "",
      ansprechpartner: person,
      vorname: contact?.firstName ?? "",
      nachname: contact?.lastName ?? "",
    },
    dokument: {
      art: kindLabel,
      nummer: doc.number,
      datum: day(doc.issueDate),
      summe_netto: eur(doc.netCents, doc.currency),
      summe_brutto: eur(doc.grossCents, doc.currency),
      gueltig_bis: day(doc.dueDate ?? new Date(doc.issueDate.getTime() + 30 * 864e5)),
      faellig_am: day(doc.dueDate),
      leistungszeitraum: period,
      kundenreferenz: doc.customerOrderRef ?? "",
      kundenreferenz_text: doc.customerOrderRef ? ` (Ihre Bestellung ${doc.customerOrderRef})` : "",
      annahme_link: extra.acceptUrl ? `Sie können das Angebot hier online annehmen: ${extra.acceptUrl}` : "",
      zahlungslink: extra.paymentUrl ?? "",
      zahlungslink_text: extra.paymentUrl ? `\nSie können die Rechnung auch bequem online bezahlen: ${extra.paymentUrl}` : "",
    },
    absender: {
      firma: sender.companyName,
      ansprechpartner: sender.userName ?? "",
      email: sender.email ?? "",
      telefon: sender.phone ?? "",
    },
  };
}
