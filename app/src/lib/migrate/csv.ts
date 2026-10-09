// CSV-Formate für den Wechsel in beide Richtungen: Brevo- und HubSpot-Export lesen, Brevo-/HubSpot-Import-CSV schreiben.
// Reine Funktionen (testbar). Parser: src/lib/a-csv.ts (RFC 4180, ; oder , automatisch).

import { normalizeAttrKey } from "./brevo-map";

export type Target =
  | "skip"
  | "email"
  | "firstName"
  | "lastName"
  | "phone"
  | "company"
  | "tags"
  | "lists"
  | "blacklisted"
  | "consent"
  | `attr:${string}`;

export type CsvFormat = "brevo" | "hubspot" | "generic";

const ALIASES: Record<Exclude<Target, `attr:${string}` | "skip">, string[]> = {
  email: ["email", "e-mail", "email address", "e-mail-adresse", "emailadresse", "mail"],
  firstName: ["firstname", "first name", "vorname"],
  lastName: ["lastname", "last name", "nachname"],
  phone: ["sms", "phone", "phone number", "telefon", "telefonnummer", "mobile phone number", "mobiltelefonnummer"],
  company: ["company", "company name", "firma", "firmenname", "unternehmen", "unternehmensname"],
  tags: ["tags", "tag"],
  lists: ["lists", "listen", "list", "liste", "list memberships", "listenmitgliedschaften"],
  blacklisted: [
    "email_blacklisted",
    "blacklisted",
    "blocklisted",
    "unsubscribed",
    "unsubscribed from all email",
    "von allen e-mails abgemeldet",
    "opted out of all email",
  ],
  consent: ["double_opt-in", "double opt-in", "doi", "consent", "einwilligung"],
};

// Spalten, die nur Metadaten des Quellsystems sind
const SKIP = [
  "contact id",
  "record id",
  "datensatz-id",
  "added_time",
  "modified_time",
  "create date",
  "erstellungsdatum",
  "last modified date",
  "zuletzt geändert",
  "ext_id",
];

const norm = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

export function detectFormat(header: string[]): CsvFormat {
  const h = header.map(norm);
  if (h.some((x) => ["record id", "datensatz-id", "lifecycle stage", "lebenszyklusphase"].includes(x))) return "hubspot";
  if (h.includes("email") && h.some((x) => x === "firstname" || x === "lastname" || x === "sms" || x === "email_blacklisted")) return "brevo";
  return "generic";
}

/** Vorschlag, welche Spalte wohin gehört. Unbekannte Spalten → eigenes Feld (attr:KEY). */
export function suggestMapping(header: string[]): Target[] {
  const used = new Set<string>();
  return header.map((raw) => {
    const h = norm(raw);
    if (!h || SKIP.includes(h)) return "skip";
    for (const [target, names] of Object.entries(ALIASES)) {
      if (names.includes(h) && !used.has(target)) {
        used.add(target);
        return target as Target;
      }
    }
    const key = normalizeAttrKey(raw.replace(/[^A-Za-z0-9_\- ]/g, "").replace(/-/g, "_"));
    return key ? (`attr:${key}` as Target) : "skip";
  });
}

export type ImportRecord = {
  email: string | null;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  tags: string[];
  lists: string[];
  blacklisted: boolean;
  consent: boolean;
  attributes: Record<string, string>;
};

const truthy = (v: string) => ["1", "true", "yes", "ja", "y", "x", "wahr"].includes(v.trim().toLowerCase());
const splitMulti = (v: string) => v.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
/** Formelschutz aus unserem Export beim Wiedereinlesen entfernen ('=… → =…). */
const unguard = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);

export function rowsToRecords(rows: string[][], mapping: Target[]): ImportRecord[] {
  return rows.map((row) => {
    const r: ImportRecord = { email: null, tags: [], lists: [], blacklisted: false, consent: false, attributes: {} };
    mapping.forEach((t, i) => {
      const v = unguard((row[i] ?? "").trim());
      if (!v || t === "skip") return;
      if (t === "email") r.email = v.toLowerCase();
      else if (t === "firstName" || t === "lastName" || t === "phone" || t === "company") r[t] = v.slice(0, 200);
      else if (t === "tags") r.tags = splitMulti(v).slice(0, 30);
      else if (t === "lists") r.lists = splitMulti(v).slice(0, 50);
      else if (t === "blacklisted") r.blacklisted = truthy(v);
      else if (t === "consent") r.consent = truthy(v);
      else if (t.startsWith("attr:")) r.attributes[t.slice(5)] = v.slice(0, 2000);
    });
    return r;
  });
}

/**
 * CSV-Zelle für Export. Schutz vor Formel-Injection in Tabellenprogrammen,
 * aber Telefonnummern/Zahlen wie „+49 151 …“ oder „-5“ bleiben unverändert (sonst kaputt beim Re-Import).
 */
export function csvCell(v: string | number | boolean | null | undefined): string {
  let s = v == null ? "" : String(v);
  const looksNumeric = /^[+-][\d\s()./-]*\d[\d\s()./-]*$/.test(s);
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !looksNumeric)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(rows: (string | number | boolean | null | undefined)[][], delimiter = ","): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(delimiter)).join("\r\n");
}

export type ExportContact = {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  company: string | null;
  tags: string[];
  lists: string[];
  unsubscribed: boolean;
  consent: boolean;
  attributes: Record<string, unknown>;
};

const attrVal = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Brevo-Import-CSV: Spaltennamen = Brevo-Attributnamen. */
export function toBrevoCsv(contacts: ExportContact[], attrKeys: string[]): string {
  const header = ["EMAIL", "FIRSTNAME", "LASTNAME", "SMS", "COMPANY", ...attrKeys, "DOUBLE_OPT-IN", "EMAIL_BLACKLISTED", "LISTS", "TAGS"];
  const rows = contacts.map((c) => [
    c.email,
    c.firstName,
    c.lastName,
    c.phone,
    c.company,
    ...attrKeys.map((k) => attrVal(c.attributes[k])),
    c.consent ? "1" : "",
    c.unsubscribed ? "true" : "false",
    c.lists.join(";"),
    c.tags.join(";"),
  ]);
  return writeCsv([header, ...rows]);
}

/** HubSpot-Import-CSV: englische Standardspalten, eigene Felder mit ihrem Bezeichner. */
export function toHubspotCsv(contacts: ExportContact[], attrs: { key: string; label: string }[]): string {
  const header = [
    "Email",
    "First Name",
    "Last Name",
    "Phone Number",
    "Company Name",
    ...attrs.map((a) => a.label || a.key),
    "Marketing contact status",
    "Unsubscribed from all email",
    "Lists",
    "Tags",
  ];
  const rows = contacts.map((c) => [
    c.email,
    c.firstName,
    c.lastName,
    c.phone,
    c.company,
    ...attrs.map((a) => attrVal(c.attributes[a.key])),
    c.consent && !c.unsubscribed ? "Marketing contact" : "Non-marketing contact",
    c.unsubscribed ? "true" : "false",
    c.lists.join(";"),
    c.tags.join(";"),
  ]);
  return writeCsv([header, ...rows]);
}
