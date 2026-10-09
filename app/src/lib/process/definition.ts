import { z } from "zod";

// Gemeinsame Prozess-Definition für Engine (Server), Flow-Editor (Client) und MCP.
// Ein Prozess = Auslöser + Einschreibungsfilter + Graph aus Knoten/Kanten (+ optionales Ziel).
// Veröffentlichte Versionen sind unveränderlich; Läufe bleiben auf ihrer Version.

export const OBJECT_TYPES = ["contact", "company", "deal", "ticket"] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export const OBJECT_LABELS: Record<ObjectType, string> = {
  contact: "Kontakt",
  company: "Unternehmen",
  deal: "Deal",
  ticket: "Ticket",
};

// ---------- Auslöser (entsprechen Ereignistypen der Outbox, siehe src/lib/events.ts) ----------

export const TRIGGER_TYPES = {
  "contact.created": { label: "Kontakt wurde angelegt", objectType: "contact" },
  "form.submitted": { label: "Formular wurde ausgefüllt", objectType: "contact" },
  "consent.confirmed": { label: "E-Mail-Einwilligung bestätigt (DOI)", objectType: "contact" },
  "agent.request": { label: "Anfrage über KI-Agent", objectType: "contact" },
  "contact.property_changed": { label: "Kontakt-Eigenschaft geändert", objectType: "contact" },
  "contact.lifecycle_changed": { label: "Lifecycle-Phase geändert", objectType: "contact" },
  "contact.tag_added": { label: "Tag wurde gesetzt", objectType: "contact" },
  "contact.list_added": { label: "Zu Liste hinzugefügt", objectType: "contact" },
  "email.event": { label: "E-Mail-Ereignis (Bounce, Klick …)", objectType: "contact" },
  "company.created": { label: "Unternehmen wurde angelegt", objectType: "company" },
  "deal.created": { label: "Deal wurde angelegt", objectType: "deal" },
  "deal.stage_changed": { label: "Deal wechselt Phase", objectType: "deal" },
  "ticket.created": { label: "Ticket wurde angelegt", objectType: "ticket" },
  "ticket.stage_changed": { label: "Ticket wechselt Status", objectType: "ticket" },
  "mention.found": { label: "Neue relevante Presse-Erwähnung", objectType: "company" },
  // Belege & Termine: Ereignisse am Beleg, eingeschrieben wird der Kontakt des Belegs (data.contactId)
  "quote.accepted": { label: "Angebot angenommen", objectType: "contact" },
  "order.created": { label: "Auftragsbestätigung erstellt", objectType: "contact" },
  "invoice.sent": { label: "Beleg versendet (Angebot, AB, Rechnung)", objectType: "contact" },
  "meeting.scheduled": { label: "Termin geplant", objectType: "contact" },
  "meeting.booked": { label: "Termin online gebucht", objectType: "contact" },
  "conversation.message_received": { label: "Nachricht im Posteingang eingegangen", objectType: "contact" },
  "subscription.created": { label: "Abo angelegt", objectType: "contact" },
  "subscription.cancelled": { label: "Abo gekündigt", objectType: "contact" },
  "invoice.overdue": { label: "Rechnung überfällig", objectType: "contact" },
  "invoice.paid": { label: "Rechnung bezahlt", objectType: "contact" },
  "debit.returned": { label: "Rücklastschrift", objectType: "contact" },
  "schedule.daily": { label: "Täglich prüfen (zeitbasiert)", objectType: null },
  manual: { label: "Manuell / per MCP einschreiben", objectType: null },
} as const satisfies Record<string, { label: string; objectType: ObjectType | null }>;
export type TriggerType = keyof typeof TRIGGER_TYPES;

// ---------- Bedingungen ----------

export const CONDITION_OPS = {
  eq: "ist gleich",
  neq: "ist nicht gleich",
  contains: "enthält",
  not_contains: "enthält nicht",
  in: "ist eins von",
  gt: "größer als",
  lt: "kleiner als",
  is_set: "ist gesetzt",
  is_not_set: "ist leer",
  days_ago_gt: "liegt mehr als N Tage zurück",
  days_ago_lt: "liegt weniger als N Tage zurück",
} as const;
export type ConditionOp = keyof typeof CONDITION_OPS;

/**
 * Feldpfade: "<objekt>.<feld>" bzw. "<objekt>.attributes.<KEY>", z. B.
 * contact.lifecycleStage, contact.email, contact.tags, contact.trustScore, contact.attributes.BRANCHE,
 * deal.valueCents, deal.stage.kind, deal.updatedAt, ticket.priority, company.domain,
 * event.<feld> (Daten des auslösenden Ereignisses), context.<schlüssel> (Ergebnisse früherer Schritte)
 */
export const fieldPath = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^(contact|company|deal|ticket|event|context)(\.[A-Za-z0-9_-]+)+$/, "Ungültiger Feldpfad");

export const conditionSchema = z.object({
  field: fieldPath,
  op: z.enum(Object.keys(CONDITION_OPS) as [ConditionOp, ...ConditionOp[]]),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)]).optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const conditionGroupSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(conditionSchema).max(20).default([]),
});
export type ConditionGroup = z.infer<typeof conditionGroupSchema>;

// ---------- Knoten ----------

const text = (max: number) => z.string().trim().min(1, "Pflichtfeld").max(max);
const optText = (max: number) => z.string().trim().max(max).optional();
const id = z.string().trim().min(1).max(60);

/** Konfiguration je Knotentyp. `external: true` = Außenwirkung → Prozessversion braucht Freigabe. */
export const NODE_TYPES = {
  // Aktionen
  "action.set_property": {
    label: "Eigenschaft setzen",
    group: "Daten",
    external: false,
    config: z.object({ field: fieldPath, value: z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]) }),
  },
  "action.set_lifecycle": {
    label: "Lifecycle-Phase setzen",
    group: "Daten",
    external: false,
    config: z.object({ stage: text(40), onlyForward: z.boolean().default(true) }),
  },
  "action.add_tag": { label: "Tag setzen", group: "Daten", external: false, config: z.object({ tag: text(60) }) },
  "action.remove_tag": { label: "Tag entfernen", group: "Daten", external: false, config: z.object({ tag: text(60) }) },
  "action.add_to_list": { label: "Zu Liste hinzufügen", group: "Daten", external: false, config: z.object({ listId: id }) },
  "action.remove_from_list": { label: "Aus Liste entfernen", group: "Daten", external: false, config: z.object({ listId: id }) },
  "action.associate_company": {
    label: "Unternehmen per E-Mail-Domain zuordnen",
    group: "Daten",
    external: false,
    config: z.object({ createIfMissing: z.boolean().default(true), ignoreFreemail: z.boolean().default(true) }),
  },
  "action.assign_owner": {
    label: "Zuständige Person zuweisen",
    group: "Vertrieb",
    external: false,
    config: z.object({ strategy: z.enum(["round_robin", "fixed", "company_owner"]), userIds: z.array(id).max(50).default([]) }),
  },
  "action.create_task": {
    label: "Aufgabe anlegen",
    group: "Vertrieb",
    external: false,
    config: z.object({ title: text(200), dueDays: z.number().int().min(0).max(365).default(1), assignTo: z.enum(["owner", "unassigned"]).default("owner") }),
  },
  "action.create_deal": {
    label: "Deal anlegen",
    group: "Vertrieb",
    external: false,
    config: z.object({ title: text(200), stageId: id.optional(), valueCents: z.number().int().min(0).max(1e11).default(0) }),
  },
  "action.create_ticket": {
    label: "Ticket anlegen",
    group: "Service",
    external: false,
    config: z.object({ subject: text(200), priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"), slaHours: z.number().int().min(0).max(24 * 60).optional() }),
  },
  "action.set_stage": {
    label: "Phase/Status setzen (Deal/Ticket)",
    group: "Vertrieb",
    external: false,
    config: z.object({ stageId: id }),
  },
  "action.notify_internal": {
    label: "Team intern benachrichtigen",
    group: "Kommunikation",
    external: false,
    config: z.object({ subject: text(200), body: text(5000), to: z.enum(["owner", "workspace_admins"]).default("owner") }),
  },
  "action.send_email": {
    label: "E-Mail an Kontakt senden",
    group: "Kommunikation",
    external: true,
    config: z.object({
      templateId: z.number().int().positive().optional(),
      subject: optText(200),
      body: optText(10_000),
      // transactional = Antwort auf Anfrage; marketing = nur mit Einwilligung, nie an Abgemeldete
      mode: z.enum(["transactional", "marketing"]),
    }),
  },
  "action.send_channel_message": {
    label: "WhatsApp/SMS an Kontakt senden",
    group: "Kommunikation",
    external: true,
    config: z.object({
      channel: z.enum(["whatsapp", "sms"]),
      text: optText(1000),
      // WhatsApp außerhalb des 24-h-Fensters nur mit freigegebener Meta-Vorlage
      // (flach gehalten, damit der Editor die Felder direkt anbieten kann)
      templateName: optText(120),
      templateLanguage: z.string().trim().min(2).max(10).default("de"),
      templateParams: z.array(z.string().max(500)).max(10).default([]),
      purpose: z.enum(["transactional", "marketing"]),
    }),
  },
  // Belege (Angebot → Auftragsbestätigung → Rechnung)
  "action.create_order_confirmation": {
    label: "Auftragsbestätigung erstellen",
    group: "Belege",
    external: false,
    // event = Angebot aus dem Ereignis (Auslöser „Angebot angenommen“); latest_accepted = jüngstes angenommenes Angebot des Kontakts
    config: z.object({ quoteSource: z.enum(["event", "latest_accepted"]).default("event") }),
  },
  "action.create_invoice_from_order": {
    label: "Rechnung aus Auftragsbestätigung erstellen",
    group: "Belege",
    external: false,
    // previous_step = AB aus einem vorherigen Schritt dieses Laufs; event = AB aus dem Ereignis
    config: z.object({ orderSource: z.enum(["previous_step", "event"]).default("previous_step") }),
  },
  "action.send_document": {
    label: "Beleg per E-Mail senden (mit PDF)",
    group: "Belege",
    external: true,
    config: z.object({
      // order/invoice = Beleg aus vorherigem Schritt (sonst aus dem Ereignis); event = Beleg des Ereignisses
      document: z.enum(["order", "invoice", "event"]).default("order"),
      withAcceptLink: z.boolean().default(false),
    }),
  },
  // Termine (Einladung an Kunden läuft immer über die Freigabe: ein Mensch bestätigt die Zeit)
  "action.schedule_meeting": {
    label: "Termin vorschlagen (mit Video-Call)",
    group: "Termine",
    external: true,
    config: z.object({
      meetingTypeId: id,
      // frühester Termin: nach N Werktagen; gewählt wird der nächste freie Platz der zuständigen Person
      afterWorkdays: z.number().int().min(0).max(30).default(2),
    }),
  },
  "action.webhook": {
    label: "Webhook aufrufen",
    group: "Integration",
    external: true,
    config: z.object({ webhookId: z.number().int().positive() }),
  },
  // KI-Erkennung (lokal bzw. EU-Modell über lib/ai.ts)
  "ai.classify": {
    label: "KI: einordnen",
    group: "KI-Erkennung",
    external: false,
    config: z.object({
      input: z.array(fieldPath).min(1).max(5),
      categories: z.array(text(60)).min(2).max(20),
      target: fieldPath,
      minConfidence: z.number().min(0).max(1).default(0.7),
      // unter der Schwelle: Prüfaufgabe für einen Menschen statt Wert setzen
      onLowConfidence: z.enum(["review_task", "skip"]).default("review_task"),
    }),
  },
  "ai.extract": {
    label: "KI: Angaben herauslesen",
    group: "KI-Erkennung",
    external: false,
    config: z.object({
      input: z.array(fieldPath).min(1).max(5),
      fields: z.array(z.object({ key: z.string().regex(/^[A-Za-z0-9_]{1,40}$/), description: text(200), type: z.enum(["text", "number", "date", "boolean"]) })).min(1).max(15),
      // Ziel: Eigenschaften des Objekts (attributes) oder nur Kontext für spätere Schritte
      target: z.enum(["attributes", "context"]).default("attributes"),
      onLowConfidence: z.enum(["review_task", "skip"]).default("review_task"),
    }),
  },
  "ai.score": {
    label: "Lead-Bewertung",
    group: "KI-Erkennung",
    external: false,
    config: z.object({
      // Regelbasiert (nachvollziehbar), optional ergänzt um KI-Einschätzung
      rules: z.array(z.object({ condition: conditionSchema, points: z.number().int().min(-100).max(100) })).max(30).default([]),
      useAi: z.boolean().default(false),
      target: fieldPath.default("contact.attributes.LEAD_SCORE"),
    }),
  },
  // Logik
  "logic.if": { label: "Wenn/Dann", group: "Logik", external: false, config: conditionGroupSchema },
  "logic.wait": {
    label: "Warten",
    group: "Logik",
    external: false,
    config: z.object({ amount: z.number().int().min(1).max(365), unit: z.enum(["minutes", "hours", "days"]) }),
  },
  "logic.wait_until": {
    label: "Warten bis Bedingung erfüllt",
    group: "Logik",
    external: false,
    config: z.object({ until: conditionGroupSchema, timeoutDays: z.number().int().min(1).max(365) }),
  },
  "logic.end": { label: "Ende", group: "Logik", external: false, config: z.object({}) },
} as const;

export type NodeType = keyof typeof NODE_TYPES;
export const NODE_TYPE_KEYS = Object.keys(NODE_TYPES) as NodeType[];

/** Ausgänge je Knotentyp (Kantenbeschriftung). Jeder Knoten kann zusätzlich einen "error"-Ausgang haben. */
export function outputsOf(type: NodeType): string[] {
  if (type === "logic.if") return ["yes", "no"];
  if (type === "logic.wait_until") return ["met", "timeout"];
  if (type === "logic.end") return [];
  return ["next"];
}

export const OUTPUT_LABELS: Record<string, string> = { next: "weiter", yes: "ja", no: "nein", met: "erfüllt", timeout: "Zeit abgelaufen", error: "bei Fehler" };

export const nodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
  type: z.enum(NODE_TYPE_KEYS as [NodeType, ...NodeType[]]),
  label: optText(120),
  config: z.record(z.string(), z.unknown()).default({}),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
});
export type ProcessNode = z.infer<typeof nodeSchema>;

export const edgeSchema = z.object({
  from: z.string().max(40),
  to: z.string().max(40),
  output: z.string().max(20).default("next"),
});
export type ProcessEdge = z.infer<typeof edgeSchema>;

export const definitionSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  trigger: z.object({
    type: z.enum(Object.keys(TRIGGER_TYPES) as [TriggerType, ...TriggerType[]]),
    // z. B. { formId }, { tag }, { stageId }, { field }, { listId }, { event: "hard_bounce" }
    config: z.record(z.string(), z.unknown()).default({}),
  }),
  enrollment: z.object({
    filters: conditionGroupSchema.default({ match: "all", conditions: [] }),
    // Darf dasselbe Objekt erneut eingeschrieben werden (nach Ende des vorherigen Laufs)?
    reenroll: z.boolean().default(false),
  }),
  // Ziel erreicht → Lauf endet vorzeitig mit goal_met
  goal: conditionGroupSchema.optional(),
  start: z.string().max(40),
  nodes: z.array(nodeSchema).min(1).max(100),
  edges: z.array(edgeSchema).max(300),
});
export type ProcessDefinition = z.infer<typeof definitionSchema>;

// ---------- Prüfung ----------

export type ValidationIssue = { level: "error" | "warning"; nodeId?: string; message: string };
export type ValidationResult = { ok: boolean; external: boolean; issues: ValidationIssue[] };

/** Prüft Struktur, Knoten-Konfiguration und Graph (Erreichbarkeit, Ausgänge, Zyklen). */
export function validateDefinition(input: unknown, objectType?: ObjectType): ValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, external: false, issues: parsed.error.issues.map((i) => ({ level: "error", message: `${i.path.join(".")}: ${i.message}` })) };
  }
  const def = parsed.data;
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  if (byId.size !== def.nodes.length) issues.push({ level: "error", message: "Knoten-IDs sind nicht eindeutig." });
  if (!byId.has(def.start)) issues.push({ level: "error", message: "Startknoten existiert nicht." });

  const triggerObject = TRIGGER_TYPES[def.trigger.type].objectType;
  if (objectType && triggerObject && triggerObject !== objectType) {
    issues.push({ level: "error", message: `Auslöser passt nicht zum Objekttyp (${OBJECT_LABELS[objectType]}).` });
  }

  let external = false;
  for (const n of def.nodes) {
    const spec = NODE_TYPES[n.type];
    if (spec.external) external = true;
    const cfg = spec.config.safeParse(n.config);
    if (!cfg.success) {
      for (const i of cfg.error.issues) issues.push({ level: "error", nodeId: n.id, message: `${spec.label}: ${i.path.join(".") || "Konfiguration"} – ${i.message}` });
    }
    const allowed = [...outputsOf(n.type), "error"];
    const outs = def.edges.filter((e) => e.from === n.id);
    for (const e of outs) {
      if (!allowed.includes(e.output)) issues.push({ level: "error", nodeId: n.id, message: `Ungültiger Ausgang „${e.output}“.` });
      if (!byId.has(e.to)) issues.push({ level: "error", nodeId: n.id, message: "Verbindung zeigt auf einen fehlenden Knoten." });
    }
    for (const o of outputsOf(n.type)) {
      if (outs.filter((e) => e.output === o).length > 1) issues.push({ level: "error", nodeId: n.id, message: `Ausgang „${OUTPUT_LABELS[o] ?? o}“ ist mehrfach verbunden.` });
    }
    if (n.type === "logic.if" && !outs.some((e) => e.output === "yes") && !outs.some((e) => e.output === "no")) {
      issues.push({ level: "warning", nodeId: n.id, message: "Wenn/Dann hat keine weiterführenden Zweige." });
    }
  }

  // Erreichbarkeit und Zyklen (Prozesse sind gerichtete azyklische Graphen)
  const seen = new Set<string>();
  const stack = new Set<string>();
  let cycle = false;
  const visit = (nid: string) => {
    if (stack.has(nid)) {
      cycle = true;
      return;
    }
    if (seen.has(nid)) return;
    seen.add(nid);
    stack.add(nid);
    for (const e of def.edges.filter((x) => x.from === nid)) visit(e.to);
    stack.delete(nid);
  };
  if (byId.has(def.start)) visit(def.start);
  if (cycle) issues.push({ level: "error", message: "Der Ablauf enthält eine Schleife. Prozesse dürfen nicht im Kreis laufen." });
  for (const n of def.nodes) if (!seen.has(n.id)) issues.push({ level: "warning", nodeId: n.id, message: "Knoten ist nicht erreichbar." });

  return { ok: !issues.some((i) => i.level === "error"), external, issues };
}

/** Leerer Startentwurf für einen neuen Prozess. */
export function emptyDefinition(trigger: TriggerType): ProcessDefinition {
  return {
    schemaVersion: 1,
    trigger: { type: trigger, config: {} },
    enrollment: { filters: { match: "all", conditions: [] }, reenroll: false },
    start: "ende",
    nodes: [{ id: "ende", type: "logic.end", config: {}, position: { x: 0, y: 200 } }],
    edges: [],
  };
}
