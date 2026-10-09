// Platzhalter in Terminvorlagen: {{ contact.FIRSTNAME }}, {{ company.name }}, {{ deal.title }},
// {{ owner.name }}, {{ meeting.date }} … mit optionalem Standardwert: {{ contact.FIRSTNAME | default: "zusammen" }}.
// Reines Text-Ersetzen ohne Code-Ausführung; nur eigene Eigenschaften, keine Prototypen.

export type MeetingTemplateContext = {
  contact?: Record<string, unknown>;
  company?: Record<string, unknown>;
  deal?: Record<string, unknown>;
  owner?: Record<string, unknown>;
  meeting?: Record<string, unknown>;
};

type Root = "contact" | "company" | "deal" | "owner" | "meeting";
const PLACEHOLDER = /\{\{\s*(contact|company|deal|owner|meeting)\.([A-Za-z0-9_]{1,40})\s*(?:\|\s*default\s*:\s*(?:"([^"]*)"|'([^']*)'))?\s*\}\}/g;

export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "{{ contact.FIRSTNAME }}", label: "Vorname Kontakt" },
  { key: "{{ contact.LASTNAME }}", label: "Nachname Kontakt" },
  { key: "{{ contact.NAME }}", label: "Name Kontakt" },
  { key: "{{ company.name }}", label: "Unternehmen" },
  { key: "{{ deal.title }}", label: "Deal" },
  { key: "{{ owner.name }}", label: "Organisator" },
  { key: "{{ owner.email }}", label: "E-Mail Organisator" },
  { key: "{{ meeting.date }}", label: "Datum/Uhrzeit" },
  { key: "{{ meeting.duration }}", label: "Dauer (Min.)" },
  { key: "{{ meeting.joinUrl }}", label: "Video-Link" },
  { key: "{{ meeting.workspace }}", label: "Sub-Account" },
];

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

export function renderMeetingTemplate(input: string, ctx: MeetingTemplateContext): string {
  return input.replace(PLACEHOLDER, (_m, root: Root, key: string, defDq?: string, defSq?: string) => {
    const obj = ctx[root];
    const raw = obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
    const value = stringify(raw).replace(/[\r\n]+/g, " ").trim();
    return value || (defDq ?? defSq ?? "");
  });
}

/** Platzhalter, die im Text vorkommen, aber nicht bekannt sind (für Validierung im Editor). */
export function unknownPlaceholders(input: string): string[] {
  const out: string[] = [];
  for (const m of input.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    if (!/^(contact|company|deal|owner|meeting)\.[A-Za-z0-9_]{1,40}(\s*\|\s*default\s*:\s*("[^"]*"|'[^']*'))?$/.test(m[1].trim())) out.push(m[0]);
  }
  return out;
}
