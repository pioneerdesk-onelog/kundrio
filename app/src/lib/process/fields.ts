// Feld-Katalog der Prozesse – EINZIGE Quelle für Editor, Referenzprüfung (Server) und MCP.
// Rein (ohne DB/server-only): Die Daten des Sub-Accounts werden als CatalogData übergeben
// (geladen in ./fields-server.ts). Angeboten wird nur, was es im Sub-Account wirklich gibt.

import { TOPICS } from "@/lib/research/types";
import {
  CONDITION_OPS,
  NODE_TYPES,
  OUTPUT_LABELS,
  TRIGGER_TYPES,
  type Condition,
  type ConditionGroup,
  type ConditionOp,
  type ObjectType,
  type ProcessDefinition,
  type ProcessNode,
  type TriggerType,
  type ValidationIssue,
} from "./definition";

export type Opt = { value: string; label: string };
export type FieldType = "text" | "number" | "date" | "boolean" | "select" | "multiselect" | "reference";
export type RefKind = "user" | "stage" | "list" | "form" | "template" | "webhook" | "company" | "meetingType" | "inbox";

export type CatalogField = {
  path: string;
  label: string;
  group: string;
  type: FieldType;
  /** Erlaubte Werte (select, multiselect, reference mit Auswahl) */
  options?: Opt[];
  ref?: RefKind;
  /** Darf per „Eigenschaft setzen“ bzw. als KI-Ziel geschrieben werden */
  writable?: boolean;
};

export type CatalogData = {
  properties: { key: string; label: string; objectType: string; type: string; options?: unknown }[];
  lifecycleStages: Opt[];
  stages: (Opt & { objectType: string; kind: string })[];
  lists: Opt[];
  users: Opt[];
  forms: Opt[];
  templates: Opt[];
  webhooks: Opt[];
  tags: string[];
  /** Terminvorlagen des Sub-Accounts (optional für ältere Aufrufer) */
  meetingTypes?: Opt[];
  /** Posteingänge/Kanäle des Sub-Accounts (optional für ältere Aufrufer) */
  inboxes?: (Opt & { kind: string })[];
};

export const EMAIL_EVENTS: Opt[] = [
  { value: "delivered", label: "zugestellt" },
  { value: "hard_bounce", label: "unzustellbar (hart)" },
  { value: "soft_bounce", label: "vorübergehend unzustellbar" },
  { value: "spam", label: "als Spam gemeldet" },
  { value: "opened", label: "geöffnet" },
  { value: "click", label: "Link geklickt" },
  { value: "unsubscribed", label: "abgemeldet" },
];

export const CHANNELS: Opt[] = [
  { value: "email", label: "E-Mail" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
];
const INTERVALS: Opt[] = [
  { value: "monthly", label: "monatlich" },
  { value: "quarterly", label: "vierteljährlich" },
  { value: "yearly", label: "jährlich" },
  { value: "one_time", label: "einmalig" },
];
// Häufige SEPA-Rückgabegründe (R-Transaktionen)
/** Zahlwege für den Auslöser „Rechnung bezahlt“ (data.via, siehe lib/payments/paid-event.ts). */
export const PAID_VIA: Opt[] = [
  { value: "online", label: "Online-Zahlung (Mollie, Revolut, Unzer)" },
  { value: "bank", label: "Überweisung (Kontoabgleich)" },
  { value: "sepa", label: "SEPA-Lastschrift" },
  { value: "manual", label: "Manuell als bezahlt markiert" },
  { value: "lexware", label: "Aus Lexware übernommen" },
];

export const RETURN_REASONS: Opt[] = [
  { value: "AC04", label: "AC04 Konto erloschen" },
  { value: "AC06", label: "AC06 Konto gesperrt" },
  { value: "AM04", label: "AM04 Deckung unzureichend" },
  { value: "MD01", label: "MD01 Kein Mandat" },
  { value: "MD06", label: "MD06 Rückgabe auf Kundenwunsch" },
  { value: "MS02", label: "MS02 Grund nicht angegeben (Kunde)" },
  { value: "MS03", label: "MS03 Grund nicht angegeben (Bank)" },
  { value: "SL01", label: "SL01 Spezifische Dienstleistung der Bank" },
];

const ACCEPT_VIA: Opt[] = [
  { value: "user", label: "im CRM (Team)" },
  { value: "customer", label: "online durch den Kunden" },
  { value: "order", label: "beim Erstellen der AB" },
  { value: "invoice", label: "beim Erstellen der Rechnung" },
];
const DOC_KINDS: Opt[] = [
  { value: "QUOTE", label: "Angebot" },
  { value: "ORDER", label: "Auftragsbestätigung" },
  { value: "INVOICE", label: "Rechnung" },
];
const VIDEO_PROVIDERS: Opt[] = [
  { value: "google_meet", label: "Google Meet" },
  { value: "ms_teams", label: "Microsoft Teams" },
  { value: "jitsi", label: "Jitsi" },
  { value: "opentalk", label: "OpenTalk" },
  { value: "phone", label: "Telefon" },
  { value: "onsite", label: "vor Ort" },
  { value: "none", label: "ohne" },
];

const STAGE_KINDS: Opt[] = [
  { value: "OPEN", label: "offen" },
  { value: "WON", label: "gewonnen" },
  { value: "LOST", label: "verloren" },
  { value: "CLOSED", label: "geschlossen" },
];
const PRIORITIES: Opt[] = [
  { value: "low", label: "niedrig" },
  { value: "medium", label: "mittel" },
  { value: "high", label: "hoch" },
  { value: "urgent", label: "dringend" },
];
const TICKET_SOURCES: Opt[] = ["email", "form", "agent", "phone", "chat", "manual", "api", "import"].map((v) => ({
  value: v,
  label: { email: "E-Mail", form: "Formular", agent: "KI-Agent", phone: "Telefon", chat: "Chat", manual: "manuell", api: "API", import: "Import" }[v]!,
}));

export const GROUP_LABELS: Record<ObjectType | "event" | "context", string> = {
  contact: "Kontakt",
  company: "Unternehmen",
  deal: "Deal",
  ticket: "Ticket",
  event: "Auslösendes Ereignis",
  context: "Ergebnisse früherer Schritte",
};

/**
 * Beschreibbare Kernfelder (Engine `setField` nutzt dieselbe Tabelle).
 * Lifecycle, Zuständige, Phasen und Tags haben eigene Aktionen und sind hier bewusst nicht enthalten.
 */
export const WRITABLE: Record<ObjectType, Record<string, "text" | "int" | "date">> = {
  contact: { firstName: "text", lastName: "text", phone: "text", company: "text", source: "text", notes: "text" },
  company: { name: "text", domain: "text", industry: "text", size: "text", phone: "text", website: "text", address: "text" },
  deal: { title: "text", valueCents: "int" },
  ticket: { subject: "text", description: "text", priority: "text", slaDueAt: "date" },
};

/** Welche Objekte ein Prozess dieses Objekttyps sieht (entspricht dem Laden in state.ts). */
export function objectsFor(objectType: ObjectType): ObjectType[] {
  if (objectType === "contact") return ["contact", "company"];
  if (objectType === "company") return ["company"];
  return [objectType, "contact", "company"];
}

type Core = [field: string, label: string, type: FieldType, extra?: Partial<CatalogField>];

function coreDefs(d: CatalogData): Record<ObjectType, Core[]> {
  const stagesOf = (ot: string) => d.stages.filter((s) => s.objectType === ot).map(({ value, label }) => ({ value, label }));
  return {
    contact: [
      ["email", "E-Mail", "text"],
      ["firstName", "Vorname", "text"],
      ["lastName", "Nachname", "text"],
      ["phone", "Telefon", "text"],
      ["company", "Firma (Freitext)", "text"],
      ["emailDomain", "E-Mail-Domain", "text"],
      ["lastActivityText", "Letzte Nachricht/Notiz", "text"],
      ["notes", "Notizen", "text"],
      ["lifecycleStage", "Lifecycle-Phase", "select", { options: d.lifecycleStages }],
      ["tags", "Tags", "multiselect", { options: d.tags.map((t) => ({ value: t, label: t })) }],
      ["source", "Quelle", "text"],
      ["trustScore", "Echtheit (0–100)", "number"],
      ["ownerId", "Zuständige Person", "reference", { ref: "user", options: d.users }],
      ["companyId", "Verknüpftes Unternehmen", "reference", { ref: "company" }],
      ["consentEmailAt", "E-Mail-Einwilligung am", "date"],
      ["unsubscribedAt", "Abgemeldet am", "date"],
      ["createdAt", "Angelegt am", "date"],
      ["updatedAt", "Zuletzt geändert", "date"],
    ],
    company: [
      ["name", "Name", "text"],
      ["domain", "Domain", "text"],
      ["industry", "Branche", "text"],
      ["size", "Größe", "text"],
      ["phone", "Telefon", "text"],
      ["website", "Website", "text"],
      ["address", "Adresse", "text"],
      ["lifecycleStage", "Lifecycle-Phase", "select", { options: d.lifecycleStages }],
      ["ownerId", "Zuständige Person", "reference", { ref: "user", options: d.users }],
      ["createdAt", "Angelegt am", "date"],
    ],
    deal: [
      ["title", "Titel", "text"],
      ["valueCents", "Wert (Cent)", "number"],
      ["stageId", "Phase", "reference", { ref: "stage", options: stagesOf("deal") }],
      ["stage.kind", "Phasen-Art", "select", { options: STAGE_KINDS.filter((k) => k.value !== "CLOSED") }],
      ["lostReason", "Verlustgrund", "text"],
      ["ownerId", "Zuständige Person", "reference", { ref: "user", options: d.users }],
      ["createdAt", "Angelegt am", "date"],
      ["updatedAt", "Zuletzt geändert", "date"],
      ["closedAt", "Abgeschlossen am", "date"],
    ],
    ticket: [
      ["subject", "Betreff", "text"],
      ["description", "Beschreibung", "text"],
      ["priority", "Priorität", "select", { options: PRIORITIES }],
      ["source", "Kanal", "select", { options: TICKET_SOURCES }],
      ["stageId", "Status", "reference", { ref: "stage", options: stagesOf("ticket") }],
      ["stage.kind", "Status-Art", "select", { options: STAGE_KINDS.filter((k) => k.value === "OPEN" || k.value === "CLOSED") }],
      ["ownerId", "Zuständige Person", "reference", { ref: "user", options: d.users }],
      ["slaDueAt", "SLA fällig am", "date"],
      ["firstResponseAt", "Erste Antwort am", "date"],
      ["closedAt", "Geschlossen am", "date"],
      ["createdAt", "Angelegt am", "date"],
    ],
  };
}

function propertyOptions(raw: unknown): Opt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => (typeof o === "string" ? { value: o, label: o } : o && typeof o === "object" && "value" in o ? { value: String((o as Opt).value), label: String((o as Opt).label ?? (o as Opt).value) } : null))
    .filter((o): o is Opt => !!o && o.value !== "");
}

function propertyType(t: string): FieldType {
  return t === "number" || t === "date" || t === "boolean" || t === "select" ? t : "text";
}

/** Felder eines Objekts (Kernfelder + eigene Felder). */
export function objectFields(d: CatalogData, ot: ObjectType): CatalogField[] {
  const group = GROUP_LABELS[ot];
  const out: CatalogField[] = coreDefs(d)[ot].map(([f, label, type, extra]) => ({
    path: `${ot}.${f}`,
    label,
    group,
    type,
    writable: f in WRITABLE[ot],
    ...extra,
  }));
  for (const p of d.properties.filter((x) => x.objectType === ot)) {
    const type = propertyType(p.type);
    out.push({
      path: `${ot}.attributes.${p.key}`,
      label: `${p.label} (eigenes Feld)`,
      group,
      type,
      writable: true,
      ...(type === "select" ? { options: propertyOptions(p.options) } : {}),
    });
  }
  return out;
}

/** Daten des auslösenden Ereignisses (nur für den gewählten Auslöser). */
export function eventFields(d: CatalogData, trigger: TriggerType): CatalogField[] {
  const g = GROUP_LABELS.event;
  const stages = (ot: string) => d.stages.filter((s) => s.objectType === ot).map(({ value, label }) => ({ value, label }));
  const f = (path: string, label: string, type: FieldType, extra: Partial<CatalogField> = {}): CatalogField => ({ path: `event.${path}`, label, group: g, type, ...extra });
  switch (trigger) {
    case "form.submitted":
    case "consent.confirmed":
      return [f("formId", "Formular", "reference", { ref: "form", options: d.forms })];
    case "contact.tag_added":
      return [f("tag", "Gesetzter Tag", "select", { options: d.tags.map((t) => ({ value: t, label: t })) })];
    case "contact.lifecycle_changed":
      return [f("from", "Vorherige Phase", "select", { options: d.lifecycleStages }), f("to", "Neue Phase", "select", { options: d.lifecycleStages })];
    case "contact.property_changed":
      return [f("field", "Geändertes Feld", "text"), f("from", "Alter Wert", "text"), f("to", "Neuer Wert", "text")];
    case "contact.list_added":
      return [f("listId", "Liste", "reference", { ref: "list", options: d.lists })];
    case "deal.stage_changed":
      return [f("stageId", "Neue Phase", "reference", { ref: "stage", options: stages("deal") }), f("fromStageId", "Vorherige Phase", "reference", { ref: "stage", options: stages("deal") })];
    case "ticket.stage_changed":
      return [f("stageId", "Neuer Status", "reference", { ref: "stage", options: stages("ticket") }), f("fromStageId", "Vorheriger Status", "reference", { ref: "stage", options: stages("ticket") })];
    case "email.event":
      return [f("event", "E-Mail-Ereignis", "select", { options: EMAIL_EVENTS })];
    case "quote.accepted":
      return [
        f("number", "Angebotsnummer", "text"),
        f("grossCents", "Bruttosumme (Cent)", "number"),
        f("via", "Angenommen über", "select", { options: ACCEPT_VIA }),
      ];
    case "order.created":
      return [f("number", "AB-Nummer", "text"), f("grossCents", "Bruttosumme (Cent)", "number")];
    case "invoice.sent":
      return [f("number", "Belegnummer", "text"), f("kind", "Belegart", "select", { options: DOC_KINDS })];
    case "meeting.scheduled":
      return [
        f("meetingTypeId", "Terminvorlage", "reference", { ref: "meetingType", options: d.meetingTypes ?? [] }),
        f("videoProvider", "Video-Anbieter", "select", { options: VIDEO_PROVIDERS }),
      ];
    case "meeting.booked":
      return [f("meetingTypeId", "Terminvorlage", "reference", { ref: "meetingType", options: d.meetingTypes ?? [] })];
    case "conversation.message_received":
      return [
        f("channel", "Kanal", "select", { options: CHANNELS }),
        f("inboxId", "Posteingang", "reference", { ref: "inbox", options: (d.inboxes ?? []).map(({ value, label }) => ({ value, label })) }),
        f("newConversation", "Neues Gespräch", "boolean"),
      ];
    case "subscription.created":
      return [f("interval", "Abrechnungsintervall", "select", { options: INTERVALS })];
    case "subscription.cancelled":
      return [f("via", "Gekündigt über", "select", { options: [{ value: "user", label: "im CRM (Team)" }, { value: "customer", label: "Kundenportal" }] })];
    case "invoice.overdue":
      return [f("number", "Rechnungsnummer", "text"), f("grossCents", "Bruttosumme (Cent)", "number")];
    case "invoice.paid":
      return [f("via", "Bezahlt über", "select", { options: PAID_VIA }), f("number", "Rechnungsnummer", "text"), f("grossCents", "Bruttosumme (Cent)", "number")];
    case "debit.returned":
      return [f("reason", "Rückgabegrund", "select", { options: RETURN_REASONS }), f("feeCents", "Rücklastschrift-Gebühr (Cent)", "number")];
    case "mention.found":
      return [
        f("topics", "Themen der Erwähnung", "multiselect", { options: TOPICS.map((t) => ({ value: t, label: t })) }),
        f("sentiment", "Tonalität", "select", { options: [{ value: "positiv", label: "positiv" }, { value: "neutral", label: "neutral" }, { value: "negativ", label: "negativ" }] }),
      ];
    default:
      return [];
  }
}

/** Vorgänger eines Knotens (alle Knoten, von denen er erreichbar ist). */
export function ancestorsOf(def: Pick<ProcessDefinition, "edges">, nodeId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of def.edges) {
      if (e.to === cur && !seen.has(e.from)) {
        seen.add(e.from);
        stack.push(e.from);
      }
    }
  }
  seen.delete(nodeId);
  return seen;
}

/** Zwischenergebnisse früherer KI-Schritte (context.<knotenId>.<wert>), wie die Engine sie speichert. */
export function contextFields(def: Pick<ProcessDefinition, "nodes" | "edges">, beforeNodeId: string): CatalogField[] {
  const anc = ancestorsOf(def, beforeNodeId);
  const g = GROUP_LABELS.context;
  const out: CatalogField[] = [];
  for (const n of def.nodes) {
    if (!anc.has(n.id)) continue;
    const name = n.label || NODE_TYPES[n.type].label;
    const cfg = n.config as Record<string, unknown>;
    if (n.type === "ai.classify") {
      const cats = Array.isArray(cfg.categories) ? (cfg.categories as string[]) : [];
      out.push({ path: `context.${n.id}.category`, label: `${name}: Kategorie`, group: g, type: "select", options: cats.map((c) => ({ value: c, label: c })) });
      out.push({ path: `context.${n.id}.confidence`, label: `${name}: Sicherheit (0–1)`, group: g, type: "number" });
    } else if (n.type === "ai.extract") {
      for (const fld of (Array.isArray(cfg.fields) ? cfg.fields : []) as { key?: string; description?: string; type?: string }[]) {
        if (!fld?.key) continue;
        out.push({ path: `context.${n.id}.${fld.key}`, label: `${name}: ${fld.description || fld.key}`, group: g, type: propertyType(fld.type ?? "text") });
      }
    } else if (n.type === "ai.score") {
      out.push({ path: `context.${n.id}.score`, label: `${name}: Punkte`, group: g, type: "number" });
    } else if (n.type === "action.create_order_confirmation") {
      out.push({ path: `context.${n.id}.number`, label: `${name}: AB-Nummer`, group: g, type: "text" });
    } else if (n.type === "action.create_invoice_from_order") {
      out.push({ path: `context.${n.id}.number`, label: `${name}: Rechnungsnummer`, group: g, type: "text" });
    }
  }
  return out;
}

export type Scope = { kind: "trigger" } | { kind: "node"; nodeId: string };

/** Alle Felder, die an dieser Stelle des Prozesses verfügbar sind. */
export function availableFields(d: CatalogData, objectType: ObjectType, def: Pick<ProcessDefinition, "trigger" | "nodes" | "edges">, scope: Scope): CatalogField[] {
  const out = objectsFor(objectType).flatMap((ot) => objectFields(d, ot));
  out.push(...eventFields(d, def.trigger.type));
  if (scope.kind === "node") out.push(...contextFields(def, scope.nodeId));
  return out;
}

/** Alle Felder des Prozesses inkl. aller KI-Zwischenergebnisse (für Beschriftungen, nicht zur Auswahl). */
export function allFields(d: CatalogData, objectType: ObjectType, def: Pick<ProcessDefinition, "trigger" | "nodes" | "edges">): CatalogField[] {
  const out = availableFields(d, objectType, def, { kind: "trigger" });
  // Vorgänger eines virtuellen Endknotens = alle Knoten
  const all = { ...def, edges: [...def.edges, ...def.nodes.map((n) => ({ from: n.id, to: "__alle__", output: "next" }))] };
  out.push(...contextFields(all, "__alle__"));
  return out;
}

/** Beschreibbare Felder (Eigenschaft setzen, KI-Ziele). */
export function writableFields(d: CatalogData, objectType: ObjectType): CatalogField[] {
  return objectsFor(objectType).flatMap((ot) => objectFields(d, ot)).filter((f) => f.writable);
}

/** Vergleiche, die zum Feldtyp passen. */
export const OPS_BY_TYPE: Record<FieldType, ConditionOp[]> = {
  text: ["eq", "neq", "contains", "not_contains", "in", "is_set", "is_not_set"],
  number: ["eq", "neq", "gt", "lt", "is_set", "is_not_set"],
  date: ["days_ago_gt", "days_ago_lt", "is_set", "is_not_set"],
  boolean: ["eq", "is_set", "is_not_set"],
  select: ["eq", "neq", "in", "is_set", "is_not_set"],
  multiselect: ["contains", "not_contains", "is_set", "is_not_set"],
  reference: ["eq", "neq", "in", "is_set", "is_not_set"],
};

export function opsFor(f: CatalogField): ConditionOp[] {
  // Referenzen ohne Auswahlliste (z. B. Unternehmen) nur auf „gesetzt/leer“ prüfen
  if (f.type === "reference" && !f.options) return ["is_set", "is_not_set"];
  return OPS_BY_TYPE[f.type];
}

export const TYPE_SYMBOL: Record<FieldType, string> = { text: "Aa", number: "#", date: "📅", boolean: "✓", select: "▾", multiselect: "☰", reference: "↗" };

// ---------- Referenzprüfung (rein) ----------

type Issue = ValidationIssue;
const NO_VALUE: ConditionOp[] = ["is_set", "is_not_set"];

function optionValues(f: CatalogField) {
  return new Set((f.options ?? []).map((o) => o.value));
}

function checkValueForField(f: CatalogField, value: unknown, where: string, nodeId?: string): Issue[] {
  const err = (message: string): Issue[] => [{ level: "error", nodeId, message: `${where}: ${message}` }];
  if (value === null || value === undefined || value === "") return [];
  if (f.type === "number" && (typeof value !== "number" || !Number.isFinite(value)) && Number.isNaN(Number(value))) return err(`„${f.label}“ erwartet eine Zahl.`);
  if (f.type === "boolean" && typeof value !== "boolean" && value !== "true" && value !== "false") return err(`„${f.label}“ erwartet Ja/Nein.`);
  if (f.type === "date" && !/^now(?:[+-]\d{1,5}[hd])?$/i.test(String(value)) && Number.isNaN(new Date(String(value)).getTime())) {
    return err(`„${f.label}“ erwartet ein Datum oder „in N Tagen“.`);
  }
  if ((f.type === "select" || f.type === "reference") && f.options) {
    if (!optionValues(f).has(String(value))) return err(`„${String(value)}“ ist für „${f.label}“ nicht vorhanden.`);
  }
  return [];
}

function checkCondition(c: Condition, fields: Map<string, CatalogField>, where: string, nodeId: string | undefined, extraTags: Set<string>): Issue[] {
  const f = fields.get(c.field);
  if (!f) {
    const ctx = c.field.startsWith("context.");
    return [{ level: "error", nodeId, message: `${where}: Feld „${c.field}“ ${ctx ? "stammt aus keinem vorherigen KI-Schritt" : "gibt es in diesem Sub-Account nicht"}.` }];
  }
  if (!opsFor(f).includes(c.op)) return [{ level: "error", nodeId, message: `${where}: „${CONDITION_OPS[c.op]}“ passt nicht zu „${f.label}“.` }];
  if (NO_VALUE.includes(c.op)) return [];
  if (c.op === "days_ago_gt" || c.op === "days_ago_lt" || c.op === "gt" || c.op === "lt") {
    return typeof c.value === "number" || (typeof c.value === "string" && c.value !== "" && !Number.isNaN(Number(c.value)))
      ? []
      : [{ level: "error", nodeId, message: `${where}: „${f.label}“ braucht eine Zahl als Vergleichswert.` }];
  }
  if (f.type === "multiselect") {
    const v = String(c.value ?? "");
    if (!v) return [{ level: "error", nodeId, message: `${where}: Bitte einen Wert für „${f.label}“ wählen.` }];
    const known = optionValues(f);
    return known.has(v) || extraTags.has(v.toLowerCase()) ? [] : [{ level: "warning", nodeId, message: `${where}: Tag „${v}“ ist noch bei keinem Kontakt gesetzt.` }];
  }
  const values = c.op === "in" ? (Array.isArray(c.value) ? c.value : []) : [c.value];
  if (values.length === 0 || values.every((v) => v === "" || v === undefined)) return [{ level: "error", nodeId, message: `${where}: Bitte einen Wert für „${f.label}“ wählen.` }];
  return values.flatMap((v) => checkValueForField(f, v, where, nodeId));
}

function checkGroup(g: ConditionGroup | undefined, fields: Map<string, CatalogField>, where: string, nodeId: string | undefined, extraTags: Set<string>): Issue[] {
  return (g?.conditions ?? []).flatMap((c, i) => checkCondition(c, fields, `${where}, Bedingung ${i + 1}`, nodeId, extraTags));
}

const byPath = (fs: CatalogField[]) => new Map(fs.map((f) => [f.path, f]));

/** Liegt vor `nodeId` ein Knoten des Typs (auf irgendeinem Weg)? */
function hasAncestorOfType(def: Pick<ProcessDefinition, "nodes" | "edges">, nodeId: string, type: string): boolean {
  const anc = ancestorsOf(def, nodeId);
  return def.nodes.some((n) => anc.has(n.id) && n.type === type);
}

/**
 * Prüft, ob alle Felder, Werte und IDs der Definition im Sub-Account existieren.
 * IDs fremder Sub-Accounts sind in `d` nicht enthalten und fallen damit als „nicht vorhanden“ auf.
 */
export function checkReferences(d: CatalogData, objectType: ObjectType, def: ProcessDefinition): Issue[] {
  const issues: Issue[] = [];
  const has = (opts: Opt[], v: unknown) => opts.some((o) => o.value === String(v));
  // Tags, die der Prozess selbst setzt, gelten als bekannt
  const extraTags = new Set(def.nodes.filter((n) => n.type === "action.add_tag").map((n) => String((n.config as { tag?: unknown }).tag ?? "").toLowerCase()));
  const label = (n: ProcessNode) => `„${n.label || NODE_TYPES[n.type].label}“`;

  // Auslöser
  const tc = def.trigger.config as Record<string, unknown>;
  const tl = `Auslöser „${TRIGGER_TYPES[def.trigger.type].label}“`;
  const stages = (ot: string) => d.stages.filter((s) => s.objectType === ot);
  if (tc.formId && !has(d.forms, tc.formId)) issues.push({ level: "error", message: `${tl}: Formular existiert nicht.` });
  if (tc.listId && !has(d.lists, tc.listId)) issues.push({ level: "error", message: `${tl}: Liste existiert nicht.` });
  if (tc.stage && !has(d.lifecycleStages, tc.stage)) issues.push({ level: "error", message: `${tl}: Lifecycle-Phase „${String(tc.stage)}“ existiert nicht.` });
  if (tc.stageId) {
    const ot = def.trigger.type === "ticket.stage_changed" ? "ticket" : "deal";
    if (!has(stages(ot), tc.stageId)) issues.push({ level: "error", message: `${tl}: Phase existiert nicht (oder gehört zu einer anderen Pipeline-Art).` });
  }
  if (tc.kind && !has(DOC_KINDS, tc.kind)) issues.push({ level: "error", message: `${tl}: Belegart „${String(tc.kind)}“ gibt es nicht.` });
  if (tc.inboxId && !has(d.inboxes ?? [], tc.inboxId)) issues.push({ level: "error", message: `${tl}: Posteingang existiert nicht.` });
  if (tc.channel && !has(CHANNELS, tc.channel)) issues.push({ level: "error", message: `${tl}: Kanal „${String(tc.channel)}“ gibt es nicht.` });
  if (tc.reason && !has(RETURN_REASONS, tc.reason)) issues.push({ level: "error", message: `${tl}: Rückgabegrund „${String(tc.reason)}“ gibt es nicht.` });
  if (tc.meetingTypeId && !has(d.meetingTypes ?? [], tc.meetingTypeId)) issues.push({ level: "error", message: `${tl}: Terminvorlage existiert nicht.` });
  if (tc.event && !has(EMAIL_EVENTS, tc.event)) issues.push({ level: "error", message: `${tl}: E-Mail-Ereignis „${String(tc.event)}“ gibt es nicht.` });
  if (tc.tag && !d.tags.some((t) => t.toLowerCase() === String(tc.tag).toLowerCase()) && !extraTags.has(String(tc.tag).toLowerCase())) {
    issues.push({ level: "warning", message: `${tl}: Tag „${String(tc.tag)}“ ist noch bei keinem Kontakt gesetzt.` });
  }
  if (tc.field) {
    const known = objectFields(d, "contact").map((f) => f.path.slice("contact.".length));
    if (!known.includes(String(tc.field))) issues.push({ level: "error", message: `${tl}: Feld „${String(tc.field)}“ gibt es nicht.` });
  }

  // Einschreibung & Ziel (ohne Kontextwerte)
  const triggerFields = byPath(availableFields(d, objectType, def, { kind: "trigger" }));
  issues.push(...checkGroup(def.enrollment.filters, triggerFields, "Einschreibungsfilter", undefined, extraTags));
  if (def.goal) issues.push(...checkGroup(def.goal, triggerFields, "Ziel", undefined, extraTags));

  const writable = byPath(writableFields(d, objectType));
  const objs = objectsFor(objectType);

  for (const n of def.nodes) {
    const cfg = n.config as Record<string, unknown>;
    const fields = byPath(availableFields(d, objectType, def, { kind: "node", nodeId: n.id }));
    const where = label(n);
    const err = (message: string) => issues.push({ level: "error", nodeId: n.id, message: `${where}: ${message}` });
    const warn = (message: string) => issues.push({ level: "warning", nodeId: n.id, message: `${where}: ${message}` });
    switch (n.type) {
      case "action.set_property": {
        const f = writable.get(String(cfg.field));
        if (!f) err(`Feld „${String(cfg.field)}“ ist nicht vorhanden oder nicht beschreibbar.`);
        else issues.push(...checkValueForField(f, cfg.value, where, n.id));
        break;
      }
      case "action.set_lifecycle":
        if (!has(d.lifecycleStages, cfg.stage)) err(`Lifecycle-Phase „${String(cfg.stage)}“ existiert nicht.`);
        if (!objs.includes("contact")) err("Dieser Prozesstyp hat keinen Kontakt.");
        break;
      case "action.add_to_list":
      case "action.remove_from_list":
        if (!has(d.lists, cfg.listId)) err("Liste existiert nicht.");
        break;
      case "action.set_stage": {
        if (objectType !== "deal" && objectType !== "ticket") err("„Phase setzen“ gibt es nur für Deals und Tickets.");
        else if (!has(stages(objectType), cfg.stageId)) err("Phase existiert nicht in einer Pipeline dieses Typs.");
        break;
      }
      case "action.create_deal":
        if (cfg.stageId && !has(stages("deal"), cfg.stageId)) err("Deal-Phase existiert nicht.");
        if (stages("deal").length === 0) err("Es gibt noch keine Deal-Pipeline.");
        break;
      case "action.send_email":
        if (cfg.templateId != null && !has(d.templates, cfg.templateId)) err(`E-Mail-Vorlage #${String(cfg.templateId)} existiert nicht oder ist inaktiv.`);
        if (cfg.templateId == null && (!cfg.subject || !cfg.body)) err("Bitte eine Vorlage wählen oder Betreff und Text eingeben.");
        break;
      case "action.send_channel_message": {
        if (!objs.includes("contact")) err("WhatsApp/SMS braucht einen Kontakt – nur in Kontakt-Prozessen verfügbar.");
        const tpl = { name: cfg.templateName as string | undefined };
        if (cfg.channel === "sms" && tpl?.name) err("SMS kennt keine Vorlagen – bitte Text eingeben.");
        if (cfg.channel === "sms" && !cfg.text) err("Bitte den SMS-Text eingeben.");
        if (cfg.channel === "whatsapp" && !cfg.text && !tpl?.name) err("Bitte eine WhatsApp-Vorlage oder einen Text eingeben.");
        if (cfg.channel === "whatsapp" && !tpl?.name) warn("Ohne freigegebene WhatsApp-Vorlage geht die Nachricht nur innerhalb von 24 Stunden nach der letzten Kunden-Nachricht raus.");
        if (d.inboxes && !d.inboxes.some((i) => i.kind === cfg.channel)) warn(`Noch kein aktiver ${cfg.channel === "sms" ? "SMS" : "WhatsApp"}-Kanal eingerichtet (Posteingang → Kanäle).`);
        break;
      }
      case "action.create_order_confirmation":
      case "action.create_invoice_from_order":
        if (!objs.includes("contact")) err("Belege brauchen einen Kontakt – nur in Kontakt-Prozessen verfügbar.");
        if (n.type === "action.create_invoice_from_order" && cfg.orderSource !== "event" && !hasAncestorOfType(def, n.id, "action.create_order_confirmation")) {
          err("Vorher fehlt der Schritt „Auftragsbestätigung erstellen“ – oder „aus dem Ereignis“ wählen.");
        }
        if (n.type === "action.create_invoice_from_order" && cfg.orderSource === "event" && def.trigger.type !== "order.created") {
          err("„aus dem Ereignis“ geht nur mit dem Auslöser „Auftragsbestätigung erstellt“.");
        }
        break;
      case "action.send_document": {
        if (!objs.includes("contact")) err("Belege brauchen einen Kontakt – nur in Kontakt-Prozessen verfügbar.");
        const docNode = cfg.document === "invoice" ? "action.create_invoice_from_order" : cfg.document === "order" ? "action.create_order_confirmation" : null;
        const fromTrigger = cfg.document === "event" ? ["quote.accepted", "order.created", "invoice.sent"].includes(def.trigger.type)
          : cfg.document === "order" ? def.trigger.type === "order.created"
          : def.trigger.type === "invoice.sent";
        if (docNode && !hasAncestorOfType(def, n.id, docNode) && !fromTrigger) err(`Kein Beleg verfügbar – vorher „${NODE_TYPES[docNode as keyof typeof NODE_TYPES].label}“ einfügen oder passenden Auslöser wählen.`);
        if (cfg.document === "event" && !fromTrigger) err("„Beleg des Ereignisses“ geht nur mit einem Beleg-Auslöser.");
        break;
      }
      case "action.schedule_meeting":
        if (!objs.includes("contact")) err("Termine brauchen einen Kontakt – nur in Kontakt-Prozessen verfügbar.");
        if (!has(d.meetingTypes ?? [], cfg.meetingTypeId)) err("Terminvorlage existiert nicht oder ist inaktiv.");
        break;
      case "action.webhook":
        if (!has(d.webhooks, cfg.webhookId)) err(`Webhook #${String(cfg.webhookId)} existiert nicht oder ist inaktiv.`);
        break;
      case "action.assign_owner": {
        const ids = Array.isArray(cfg.userIds) ? (cfg.userIds as string[]) : [];
        for (const u of ids) if (!has(d.users, u)) err("Eine gewählte Person hat keinen Zugriff auf diesen Sub-Account.");
        if (cfg.strategy === "fixed" && ids.length === 0) err("Bei „fest“ bitte eine Person wählen.");
        if (cfg.strategy === "company_owner" && !objs.includes("company")) err("Dieser Prozesstyp hat kein Unternehmen.");
        break;
      }
      case "ai.classify": {
        for (const p of (cfg.input as string[]) ?? []) if (!fields.has(p)) err(`Eingabefeld „${p}“ ist an dieser Stelle nicht verfügbar.`);
        const t = writable.get(String(cfg.target));
        if (!t) err(`Ziel „${String(cfg.target)}“ ist nicht vorhanden oder nicht beschreibbar.`);
        else if (t.type === "select" && t.options) {
          const allowed = optionValues(t);
          const bad = ((cfg.categories as string[]) ?? []).filter((c) => !allowed.has(c));
          if (bad.length) err(`Kategorien ${bad.map((b) => `„${b}“`).join(", ")} sind keine Werte von „${t.label}“.`);
        } else if (t.type === "number" || t.type === "date" || t.type === "boolean") err(`„${t.label}“ kann keine Kategorie aufnehmen.`);
        break;
      }
      case "ai.extract": {
        for (const p of (cfg.input as string[]) ?? []) if (!fields.has(p)) err(`Eingabefeld „${p}“ ist an dieser Stelle nicht verfügbar.`);
        if (cfg.target === "attributes") {
          for (const fld of (cfg.fields as { key: string }[]) ?? []) {
            if (!writable.has(`${objectType}.attributes.${fld.key}`)) err(`Eigenes Feld „${fld.key}“ existiert für ${GROUP_LABELS[objectType]} nicht – erst unter „Listen & Felder“ anlegen oder Ziel „nur Zwischenergebnis“ wählen.`);
          }
        }
        break;
      }
      case "ai.score": {
        for (const [i, r] of ((cfg.rules as { condition: Condition }[]) ?? []).entries()) issues.push(...checkCondition(r.condition, fields, `${where}, Regel ${i + 1}`, n.id, extraTags));
        const t = writable.get(String(cfg.target ?? "contact.attributes.LEAD_SCORE"));
        if (!t) err(`Ziel „${String(cfg.target ?? "contact.attributes.LEAD_SCORE")}“ ist nicht vorhanden – eigenes Feld anlegen.`);
        else if (t.type !== "number" && t.type !== "text") err(`„${t.label}“ kann keine Punktzahl aufnehmen.`);
        break;
      }
      case "logic.if":
        issues.push(...checkGroup(cfg as unknown as ConditionGroup, fields, where, n.id, extraTags));
        break;
      case "logic.wait_until":
        issues.push(...checkGroup(cfg.until as ConditionGroup, fields, where, n.id, extraTags));
        break;
      default:
        break;
    }
  }
  return issues;
}

/** Beschriftung eines Ausgangs (für die Satz-Ansicht). */
export const outputLabel = (o: string) => OUTPUT_LABELS[o] ?? o;
