// Leitet aus den zod-Schemas der Knotentypen ein Formular ab (Feldart, Optionen, Standardwert).
// Spezielle Schemas (Feldpfad, Bedingung, Bedingungsgruppe) werden über ihre Identität erkannt.
import type { z } from "zod";
import { conditionGroupSchema, conditionSchema, fieldPath, NODE_TYPES, type NodeType } from "@/lib/process/definition";

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "value" // freier Wert (Text/Zahl/Ja-Nein/leer)
  | "fieldPath"
  | "fieldPathList"
  | "stringList"
  | "condition"
  | "conditionGroup"
  | "objectList"
  | "unknown";

export type FieldSpec = {
  key: string;
  kind: FieldKind;
  label: string;
  optional: boolean;
  defaultValue?: unknown;
  options?: string[];
  maxLength?: number;
  integer?: boolean;
  min?: number;
  /** Unterfelder bei objectList */
  item?: FieldSpec[];
};

/** Deutsche Feldbeschriftungen nach Schlüssel. */
export const FIELD_LABELS: Record<string, string> = {
  field: "Feld",
  value: "Wert",
  stage: "Lifecycle-Phase",
  onlyForward: "Nur vorwärts (nie zurückstufen)",
  tag: "Tag",
  listId: "Liste",
  createIfMissing: "Unternehmen anlegen, falls noch nicht vorhanden",
  ignoreFreemail: "Freemail-Adressen (gmail, web.de …) ignorieren",
  strategy: "Verteilung",
  userIds: "Personen",
  title: "Titel",
  dueDays: "Fällig in Tagen",
  assignTo: "Zuweisen an",
  stageId: "Phase / Status",
  valueCents: "Wert (Cent)",
  subject: "Betreff",
  priority: "Priorität",
  slaHours: "Reaktionszeit (Stunden)",
  body: "Text",
  to: "Empfänger",
  templateId: "Vorlage",
  mode: "Art der E-Mail",
  webhookId: "Webhook",
  quoteSource: "Angebot",
  orderSource: "Auftragsbestätigung",
  document: "Beleg",
  withAcceptLink: "Link zur Online-Annahme anhängen",
  meetingTypeId: "Terminvorlage",
  afterWorkdays: "Frühestens nach Werktagen",
  input: "Eingabe-Felder",
  categories: "Kategorien",
  target: "Ziel",
  minConfidence: "Mindest-Sicherheit (0–1)",
  onLowConfidence: "Bei unsicherer Erkennung",
  fields: "Angaben",
  key: "Schlüssel",
  description: "Beschreibung",
  type: "Typ",
  rules: "Regeln",
  condition: "Bedingung",
  points: "Punkte",
  useAi: "Zusätzlich KI-Einschätzung",
  match: "Verknüpfung",
  conditions: "Bedingungen",
  amount: "Dauer",
  unit: "Einheit",
  until: "Bedingung",
  timeoutDays: "Höchstens warten (Tage)",
  channel: "Kanal",
  text: "Nachricht",
  templateName: "WhatsApp-Vorlage (Name bei Meta)",
  templateLanguage: "Sprache der Vorlage",
  templateParams: "Platzhalter der Vorlage ({{1}}, {{2}} …)",
  purpose: "Zweck",
};

/** Beschriftungen für Auswahlwerte. */
export const OPTION_LABELS: Record<string, string> = {
  round_robin: "reihum verteilen",
  latest_accepted: "jüngstes angenommenes Angebot des Kontakts",
  previous_step: "aus einem vorherigen Schritt",
  event: "aus dem Ereignis",
  order: "Auftragsbestätigung",
  invoice: "Rechnung",
  fixed: "feste Person",
  company_owner: "Zuständige des Unternehmens",
  owner: "Zuständige Person",
  unassigned: "niemand (offen)",
  workspace_admins: "Admins des Sub-Accounts",
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
  urgent: "dringend",
  transactional: "Antwort auf Anfrage (transaktional)",
  whatsapp: "WhatsApp",
  sms: "SMS",
  marketing: "Marketing (nur mit Einwilligung)",
  review_task: "Prüfaufgabe für einen Menschen",
  skip: "überspringen",
  attributes: "Eigenschaften des Objekts",
  context: "nur für spätere Schritte",
  text: "Text",
  number: "Zahl",
  date: "Datum",
  boolean: "Ja/Nein",
  all: "alle müssen zutreffen",
  any: "mindestens eine trifft zu",
  minutes: "Minuten",
  hours: "Stunden",
  days: "Tage",
};

type AnySchema = z.ZodType & { def: Record<string, unknown> };

function defOf(s: unknown): Record<string, unknown> {
  return ((s as AnySchema)?.def ?? {}) as Record<string, unknown>;
}

/** Entfernt optional/default/nullable-Hüllen und merkt sich Optionalität und Standardwert. */
function unwrap(s: unknown): { inner: unknown; optional: boolean; defaultValue?: unknown } {
  let cur = s;
  let optional = false;
  let defaultValue: unknown;
  for (let i = 0; i < 6; i++) {
    const d = defOf(cur);
    if (d.type === "optional" || d.type === "nullable") {
      optional = true;
      cur = d.innerType;
    } else if (d.type === "default") {
      const dv = d.defaultValue;
      defaultValue = typeof dv === "function" ? (dv as () => unknown)() : dv;
      cur = d.innerType;
    } else break;
  }
  return { inner: cur, optional, defaultValue };
}

function maxLengthOf(s: unknown): number | undefined {
  const checks = (defOf(s).checks ?? []) as { _zod?: { def?: { check?: string; maximum?: number } } }[];
  for (const c of checks) if (c._zod?.def?.check === "max_length") return c._zod.def.maximum;
  return undefined;
}

function minOf(s: unknown): number | undefined {
  const checks = (defOf(s).checks ?? []) as { _zod?: { def?: { check?: string; value?: number } } }[];
  for (const c of checks) if (c._zod?.def?.check === "greater_than" && typeof c._zod.def.value === "number") return c._zod.def.value;
  return undefined;
}

/** Beschreibung eines einzelnen Schemas als Formularfeld. */
export function describe(key: string, schema: unknown): FieldSpec {
  const { inner, optional, defaultValue } = unwrap(schema);
  const base = { key, label: FIELD_LABELS[key] ?? key, optional, defaultValue };
  if (inner === fieldPath) return { ...base, kind: "fieldPath" };
  if (inner === conditionSchema) return { ...base, kind: "condition" };
  if (inner === conditionGroupSchema) return { ...base, kind: "conditionGroup" };
  const d = defOf(inner);
  switch (d.type) {
    case "string": {
      const max = maxLengthOf(inner);
      return { ...base, kind: max && max > 300 ? "textarea" : "text", maxLength: max };
    }
    case "number":
      return { ...base, kind: "number", integer: Boolean((inner as { isInt?: boolean }).isInt), min: minOf(inner) };
    case "boolean":
      return { ...base, kind: "boolean" };
    case "enum":
      return { ...base, kind: "select", options: ((inner as { options?: string[] }).options ?? []).map(String) };
    case "union":
      return { ...base, kind: "value" };
    case "array": {
      const el = unwrap(d.element).inner;
      if (el === fieldPath) return { ...base, kind: "fieldPathList" };
      const ed = defOf(el);
      if (ed.type === "string") return { ...base, kind: "stringList" };
      if (ed.type === "object") return { ...base, kind: "objectList", item: deriveFields(el) };
      return { ...base, kind: "unknown" };
    }
    default:
      return { ...base, kind: "unknown" };
  }
}

/** Felder eines Objekt-Schemas (Reihenfolge wie im Schema). */
export function deriveFields(schema: unknown): FieldSpec[] {
  const { inner } = unwrap(schema);
  if (inner === conditionGroupSchema) return [{ key: "__group", kind: "conditionGroup", label: "Bedingungen", optional: false }];
  const shape = (inner as { shape?: Record<string, unknown> }).shape;
  if (!shape) return [];
  return Object.entries(shape).map(([k, s]) => describe(k, s));
}

/** Formularfelder eines Knotentyps. */
export function fieldsFor(type: NodeType): FieldSpec[] {
  return deriveFields(NODE_TYPES[type].config);
}

function emptyFor(f: FieldSpec): unknown {
  if (f.defaultValue !== undefined) return structuredClone(f.defaultValue);
  if (f.optional) return undefined;
  switch (f.kind) {
    case "boolean":
      return false;
    case "number":
      return f.min ?? 0;
    case "select":
      return f.options?.[0];
    case "fieldPathList":
    case "stringList":
    case "objectList":
      return [];
    case "conditionGroup":
      return { match: "all", conditions: [] };
    case "condition":
      return { field: "contact.email", op: "is_set" };
    case "value":
      return "";
    default:
      return "";
  }
}

/** Startkonfiguration für einen neuen Knoten (Standardwerte, Pflichtfelder leer). */
export function defaultConfigFor(type: NodeType): Record<string, unknown> {
  const fields = fieldsFor(type);
  if (fields.length === 1 && fields[0].key === "__group") return { match: "all", conditions: [] };
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = emptyFor(f);
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/** Neues Listenelement für objectList-Felder. */
export function defaultItem(f: FieldSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const sub of f.item ?? []) {
    const v = emptyFor(sub);
    if (v !== undefined) out[sub.key] = v;
  }
  return out;
}
