import type { ObjectType, ProcessDefinition, ProcessEdge, ProcessNode } from "./definition";

// Best-Practice-Vorlagen. Werden je Sub-Account als Standard angelegt (ensureDefaultProcesses) und
// lassen sich danach im Flow-Editor anpassen. Kein Import von server-only (auch im Seed nutzbar).

export type ProcessTemplate = {
  key: string;
  name: string;
  description: string;
  objectType: ObjectType;
  definition: ProcessDefinition;
};

const X = 0;
const STEP_Y = 140;

type N = Omit<ProcessNode, "position"> & { position?: ProcessNode["position"] };

/** Baut eine Definition aus Knoten in Reihenfolge; Kanten "next" automatisch, Zusatzkanten optional. */
function flow(trigger: ProcessDefinition["trigger"], nodes: N[], opts: { filters?: ProcessDefinition["enrollment"]["filters"]; reenroll?: boolean; edges?: ProcessEdge[]; linear?: boolean } = {}): ProcessDefinition {
  const placed: ProcessNode[] = nodes.map((n, i) => ({ label: n.label, id: n.id, type: n.type, config: n.config ?? {}, position: n.position ?? { x: X, y: 120 + i * STEP_Y } }));
  const edges: ProcessEdge[] = opts.edges ? [...opts.edges] : [];
  if (opts.linear !== false) {
    for (let i = 0; i < placed.length - 1; i++) {
      if (placed[i].type === "logic.end") continue;
      edges.push({ from: placed[i].id, to: placed[i + 1].id, output: "next" });
    }
  }
  return {
    schemaVersion: 1,
    trigger,
    enrollment: { filters: opts.filters ?? { match: "all", conditions: [] }, reenroll: opts.reenroll ?? false },
    start: placed[0].id,
    nodes: placed,
    edges,
  };
}

const end = (id = "ende"): N => ({ id, type: "logic.end", label: "Ende", config: {} });

export const PROCESS_TEMPLATES: ProcessTemplate[] = [
  {
    key: "lead-eingang",
    name: "Lead-Eingang",
    description:
      "Neue Formular-Anfragen: Unternehmen über die E-Mail-Domain zuordnen, Lead bewerten, Lifecycle „Lead“ setzen, im Rundlauf zuweisen und eine Erstkontakt-Aufgabe für die nächsten 24 Stunden anlegen.",
    objectType: "contact",
    definition: flow({ type: "form.submitted", config: {} }, [
      { id: "firma", type: "action.associate_company", label: "Unternehmen per Domain zuordnen", config: { createIfMissing: true, ignoreFreemail: true } },
      {
        id: "bewertung",
        type: "ai.score",
        label: "Lead bewerten",
        config: {
          useAi: false,
          target: "contact.attributes.LEAD_SCORE",
          rules: [
            { condition: { field: "contact.trustScore", op: "gt", value: 70 }, points: 20 },
            { condition: { field: "contact.companyId", op: "is_set" }, points: 15 },
            { condition: { field: "contact.phone", op: "is_set" }, points: 10 },
            { condition: { field: "contact.company", op: "is_set" }, points: 5 },
            { condition: { field: "contact.consentEmailAt", op: "is_set" }, points: 10 },
          ],
        },
      },
      { id: "lifecycle", type: "action.set_lifecycle", label: "Lifecycle: Lead", config: { stage: "lead", onlyForward: true } },
      { id: "zuweisen", type: "action.assign_owner", label: "Zuständige im Rundlauf", config: { strategy: "round_robin", userIds: [] } },
      { id: "aufgabe", type: "action.create_task", label: "Erstkontakt innerhalb 24 h", config: { title: "Erstkontakt: neue Anfrage beantworten", dueDays: 1, assignTo: "owner" } },
      end(),
    ]),
  },
  {
    key: "eingangsbestaetigung",
    name: "Eingangsbestätigung per E-Mail",
    description: "Bestätigt Formular-Anfragen per E-Mail (transaktional). Bitte Text prüfen und freigeben, bevor der Prozess aktiviert wird.",
    objectType: "contact",
    definition: flow({ type: "form.submitted", config: {} }, [
      {
        id: "mail",
        type: "action.send_email",
        label: "Bestätigung senden",
        config: {
          mode: "transactional",
          subject: "Danke für Ihre Anfrage",
          body: "Hallo {{ contact.FIRSTNAME | default: \"\" }},\n\nvielen Dank für Ihre Anfrage. Wir melden uns innerhalb eines Werktages bei Ihnen.\n\nFreundliche Grüße",
        },
      },
      end(),
    ]),
  },
  {
    key: "mql-sql",
    name: "Lead-Qualifizierung (MQL)",
    description: "Erreicht ein Lead die Punkteschwelle, wird er zum Marketing-qualifizierten Lead (MQL) und die zuständige Person wird informiert.",
    objectType: "contact",
    definition: flow(
      { type: "contact.property_changed", config: { field: "attributes.LEAD_SCORE" } },
      [
        { id: "lifecycle", type: "action.set_lifecycle", label: "Lifecycle: MQL", config: { stage: "mql", onlyForward: true } },
        { id: "info", type: "action.notify_internal", label: "Zuständige informieren", config: { to: "owner", subject: "Neuer qualifizierter Lead", body: "Ein Lead hat die Punkteschwelle erreicht. Bitte zeitnah Kontakt aufnehmen." } },
        end(),
      ],
      { filters: { match: "all", conditions: [{ field: "contact.attributes.LEAD_SCORE", op: "gt", value: 49 }, { field: "contact.lifecycleStage", op: "in", value: ["subscriber", "lead"] }] } },
    ),
  },
  {
    key: "ki-agent-anfrage",
    name: "KI-Agent-Anfrage",
    description: "Anfragen über KI-Assistenten einordnen: Support wird zum Ticket, Angebots- und Terminwünsche werden zum Deal mit Aufgabe.",
    objectType: "contact",
    definition: flow(
      { type: "agent.request", config: {} },
      [
        {
          id: "einordnen",
          type: "ai.classify",
          label: "Anliegen einordnen",
          config: { input: ["contact.lastActivityText"], categories: ["Angebot", "Termin", "Support", "Sonstiges"], target: "contact.attributes.ANLIEGEN", minConfidence: 0.7, onLowConfidence: "review_task" },
          position: { x: X, y: 120 },
        },
        {
          id: "ist-support",
          type: "logic.if",
          label: "Support-Anliegen?",
          config: { match: "all", conditions: [{ field: "contact.attributes.ANLIEGEN", op: "eq", value: "Support" }] },
          position: { x: X, y: 260 },
        },
        { id: "ticket", type: "action.create_ticket", label: "Ticket anlegen", config: { subject: "Support-Anfrage über KI-Agent", priority: "medium", slaHours: 24 }, position: { x: X - 220, y: 400 } },
        { id: "deal", type: "action.create_deal", label: "Deal anlegen", config: { title: "Anfrage über KI-Agent", valueCents: 0 }, position: { x: X + 220, y: 400 } },
        { id: "aufgabe", type: "action.create_task", label: "Rückmeldung innerhalb 24 h", config: { title: "KI-Agent-Anfrage bearbeiten", dueDays: 1, assignTo: "owner" }, position: { x: X + 220, y: 540 } },
        { id: "ende", type: "logic.end", label: "Ende", config: {}, position: { x: X, y: 680 } },
      ],
      {
        linear: false,
        edges: [
          { from: "einordnen", to: "ist-support", output: "next" },
          { from: "ist-support", to: "ticket", output: "yes" },
          { from: "ist-support", to: "deal", output: "no" },
          { from: "ticket", to: "ende", output: "next" },
          { from: "deal", to: "aufgabe", output: "next" },
          { from: "aufgabe", to: "ende", output: "next" },
        ],
      },
    ),
  },
  {
    key: "deal-gewonnen",
    name: "Deal gewonnen → Kunde",
    description: "Gewonnene Deals: Kontakt wird Kunde, Onboarding-Aufgaben werden angelegt.",
    objectType: "deal",
    definition: flow(
      { type: "deal.stage_changed", config: {} },
      [
        { id: "kunde", type: "action.set_lifecycle", label: "Lifecycle: Kunde", config: { stage: "customer", onlyForward: true } },
        { id: "kickoff", type: "action.create_task", label: "Kick-off vereinbaren", config: { title: "Onboarding: Kick-off-Termin vereinbaren", dueDays: 2, assignTo: "owner" } },
        { id: "rechnung", type: "action.create_task", label: "Rechnung/Vertrag prüfen", config: { title: "Onboarding: Vertrag und erste Rechnung prüfen", dueDays: 3, assignTo: "owner" } },
        end(),
      ],
      { filters: { match: "all", conditions: [{ field: "deal.stage.kind", op: "eq", value: "WON" }] } },
    ),
  },
  {
    key: "willkommen-kunde",
    name: "Willkommens-E-Mail für Neukunden",
    description: "Schickt neuen Kunden nach gewonnenem Deal eine Willkommens-E-Mail. Bitte Text prüfen und freigeben.",
    objectType: "deal",
    definition: flow(
      { type: "deal.stage_changed", config: {} },
      [
        {
          id: "mail",
          type: "action.send_email",
          label: "Willkommen senden",
          config: { mode: "transactional", subject: "Willkommen an Bord", body: "Hallo {{ contact.FIRSTNAME | default: \"\" }},\n\nschön, dass wir zusammenarbeiten. In Kürze melden wir uns für den Kick-off.\n\nFreundliche Grüße" },
        },
        end(),
      ],
      { filters: { match: "all", conditions: [{ field: "deal.stage.kind", op: "eq", value: "WON" }] } },
    ),
  },
  {
    key: "deal-hygiene",
    name: "Deal-Hygiene",
    description: "Täglich: offene Deals, die seit 14 Tagen unverändert sind, bekommen eine Nachfass-Aufgabe (höchstens alle 7 Tage je Deal).",
    objectType: "deal",
    definition: flow(
      { type: "schedule.daily", config: {} },
      [
        { id: "aufgabe", type: "action.create_task", label: "Nachfassen", config: { title: "Deal seit 14 Tagen unverändert – nachfassen", dueDays: 1, assignTo: "owner" } },
        end(),
      ],
      {
        reenroll: true,
        filters: { match: "all", conditions: [{ field: "deal.stage.kind", op: "eq", value: "OPEN" }, { field: "deal.updatedAt", op: "days_ago_gt", value: 14 }] },
      },
    ),
  },
  {
    key: "ticket-eingang",
    name: "Ticket-Eingang",
    description: "Neue Tickets: Priorität per KI einschätzen, SLA-Frist setzen, zuweisen und bei „dringend“ das Team informieren.",
    objectType: "ticket",
    definition: flow(
      { type: "ticket.created", config: {} },
      [
        {
          id: "prio",
          type: "ai.classify",
          label: "Priorität einschätzen",
          config: { input: ["ticket.subject", "ticket.description"], categories: ["low", "medium", "high", "urgent"], target: "ticket.priority", minConfidence: 0.7, onLowConfidence: "skip" },
          position: { x: X, y: 120 },
        },
        { id: "sla", type: "action.set_property", label: "SLA-Frist: 24 h", config: { field: "ticket.slaDueAt", value: "now+24h" }, position: { x: X, y: 260 } },
        { id: "zuweisen", type: "action.assign_owner", label: "Zuständige im Rundlauf", config: { strategy: "round_robin", userIds: [] }, position: { x: X, y: 400 } },
        {
          id: "dringend",
          type: "logic.if",
          label: "Dringend?",
          config: { match: "all", conditions: [{ field: "ticket.priority", op: "eq", value: "urgent" }] },
          position: { x: X, y: 540 },
        },
        { id: "info", type: "action.notify_internal", label: "Team informieren", config: { to: "workspace_admins", subject: "Dringendes Ticket", body: "Ein neues Ticket wurde als dringend eingestuft. Bitte sofort ansehen." }, position: { x: X - 220, y: 680 } },
        { id: "ende", type: "logic.end", label: "Ende", config: {}, position: { x: X, y: 820 } },
      ],
      {
        linear: false,
        edges: [
          { from: "prio", to: "sla", output: "next" },
          { from: "sla", to: "zuweisen", output: "next" },
          { from: "zuweisen", to: "dringend", output: "next" },
          { from: "dringend", to: "info", output: "yes" },
          { from: "dringend", to: "ende", output: "no" },
          { from: "info", to: "ende", output: "next" },
        ],
      },
    ),
  },
  {
    key: "bounce-bereinigung",
    name: "Bounce-Bereinigung",
    description: "Bei hartem Bounce: Kontakt markieren und eine Aufgabe zur Prüfung der Adresse anlegen (die Sperrliste setzt das System automatisch).",
    objectType: "contact",
    definition: flow({ type: "email.event", config: { event: "hard_bounce" } }, [
      { id: "tag", type: "action.add_tag", label: "Tag: ungültige Adresse", config: { tag: "ungültige-adresse" } },
      { id: "aufgabe", type: "action.create_task", label: "Adresse prüfen", config: { title: "E-Mail-Adresse ungültig – bitte prüfen", dueDays: 3, assignTo: "owner" } },
      end(),
    ], { reenroll: true }),
  },
  {
    key: "angebot-angenommen-ab",
    name: "Angebot angenommen → Auftragsbestätigung",
    description:
      "Wird ein Angebot angenommen (im Team oder online durch den Kunden), entsteht automatisch die Auftragsbestätigung. Die zuständige Person prüft sie, danach geht sie mit PDF an den Kunden (Versand nach Freigabe des Prozesses).",
    objectType: "contact",
    definition: flow(
      { type: "quote.accepted", config: {} },
      [
        { id: "ab", type: "action.create_order_confirmation", label: "Auftragsbestätigung erstellen", config: { quoteSource: "event" } },
        { id: "pruefen", type: "action.create_task", label: "AB prüfen", config: { title: "Auftragsbestätigung prüfen (wird automatisch versendet)", dueDays: 1, assignTo: "owner" } },
        { id: "senden", type: "action.send_document", label: "AB an Kunden senden", config: { document: "order", withAcceptLink: false } },
        end(),
      ],
      {
        // Nicht starten, wenn die AB gerade von Hand erstellt wurde (das Angebot gilt dann ebenfalls als angenommen)
        filters: { match: "all", conditions: [{ field: "event.via", op: "neq", value: "order" }, { field: "event.via", op: "neq", value: "invoice" }] },
        reenroll: true,
      },
    ),
  },
  {
    key: "ab-kickoff-termin",
    name: "Auftragsbestätigung → Kickoff-Termin",
    description:
      "Nach der Auftragsbestätigung wird der Kontakt zum Kunden und ein Onboarding-Kickoff vorgeschlagen (nächster freier Platz der zuständigen Person). Die Einladung mit Video-Link geht erst raus, wenn ein Mensch die Zeit im Freigabe-Eingang bestätigt.",
    objectType: "contact",
    definition: flow(
      { type: "order.created", config: {} },
      [
        { id: "kunde", type: "action.set_lifecycle", label: "Lifecycle: Kunde", config: { stage: "customer", onlyForward: true } },
        { id: "kickoff", type: "action.schedule_meeting", label: "Kickoff vorschlagen", config: { meetingTypeId: "meetingType:Onboarding-Kickoff", afterWorkdays: 3 } },
        end(),
      ],
      { reenroll: true },
    ),
  },
  {
    key: "kritische-erwaehnung",
    name: "Kritische Presse-Erwähnung",
    description: "Meldet die Recherche eine relevante Erwähnung zu Insolvenz oder Rechtsstreit, bekommt die zuständige Person eine Aufgabe und eine interne Info.",
    objectType: "company",
    definition: flow(
      { type: "mention.found", config: {} },
      [
        { id: "aufgabe", type: "action.create_task", label: "Erwähnung prüfen", config: { title: "Kritische Presse-Erwähnung prüfen (Insolvenz/Rechtsstreit)", dueDays: 1, assignTo: "owner" } },
        { id: "info", type: "action.notify_internal", label: "Zuständige informieren", config: { to: "owner", subject: "Kritische Presse-Erwähnung", body: "Zu einem Ihrer Unternehmen wurde eine relevante Erwähnung zu Insolvenz oder Rechtsstreit gefunden. Details unter Presse & Erwähnungen." } },
        end(),
      ],
      {
        filters: { match: "any", conditions: [{ field: "event.topics", op: "contains", value: "Insolvenz" }, { field: "event.topics", op: "contains", value: "Rechtsstreit" }] },
        reenroll: true,
      },
    ),
  },
  {
    key: "termin-gebucht-vorbereitung",
    name: "Termin gebucht → Vorbereitung",
    description:
      "Bucht ein Kontakt online einen Termin: Vorbereitungs-Aufgabe für die zuständige Person, interne Info und – nach Freigabe – eine WhatsApp-Bestätigung über eine bei Meta freigegebene Vorlage.",
    objectType: "contact",
    definition: flow(
      { type: "meeting.booked", config: {} },
      [
        { id: "vorbereiten", type: "action.create_task", label: "Termin vorbereiten", config: { title: "Termin vorbereiten: Historie, offene Deals und Belege sichten", dueDays: 0, assignTo: "owner" } },
        { id: "info", type: "action.notify_internal", label: "Zuständige informieren", config: { to: "owner", subject: "Neuer Online-Termin mit {{ contact.FIRSTNAME }} {{ contact.LASTNAME }}", body: "Ein Kontakt hat online einen Termin gebucht. Details stehen im Kalender; eine Vorbereitungs-Aufgabe ist angelegt." } },
        {
          id: "whatsapp",
          type: "action.send_channel_message",
          label: "WhatsApp-Bestätigung",
          config: { channel: "whatsapp", purpose: "transactional", templateName: "termin_bestaetigung", templateLanguage: "de", templateParams: ["{{ contact.FIRSTNAME }}"] },
        },
        end(),
      ],
      { reenroll: true },
    ),
  },
  {
    key: "posteingang-neue-anfrage",
    name: "Neue Anfrage im Posteingang → Zuständige + SLA-Aufgabe",
    description:
      "Beginnt ein Kontakt ein neues Gespräch im gemeinsamen Posteingang (E-Mail, WhatsApp, SMS): ohne Zuständige wird reihum zugewiesen, dann entsteht eine Antwort-Aufgabe mit Frist am selben Tag.",
    objectType: "contact",
    definition: flow(
      { type: "conversation.message_received", config: {} },
      [
        { id: "hat-zustaendige", type: "logic.if", label: "Schon zuständig?", config: { match: "all", conditions: [{ field: "contact.ownerId", op: "is_set" }] }, position: { x: X, y: 120 } },
        { id: "zuweisen", type: "action.assign_owner", label: "Zuständige im Rundlauf", config: { strategy: "round_robin", userIds: [] }, position: { x: X + 220, y: 260 } },
        { id: "aufgabe", type: "action.create_task", label: "Antwort heute (SLA)", config: { title: "Posteingang: neue Anfrage beantworten (SLA heute)", dueDays: 0, assignTo: "owner" }, position: { x: X, y: 400 } },
        { id: "ende", type: "logic.end", label: "Ende", config: {}, position: { x: X, y: 540 } },
      ],
      {
        linear: false,
        reenroll: true,
        edges: [
          { from: "hat-zustaendige", to: "aufgabe", output: "yes" },
          { from: "hat-zustaendige", to: "zuweisen", output: "no" },
          { from: "zuweisen", to: "aufgabe", output: "next" },
          { from: "aufgabe", to: "ende", output: "next" },
        ],
      },
    ),
  },
  {
    key: "ruecklastschrift",
    name: "Rücklastschrift → Aufgabe + interne Info",
    description:
      "Gibt die Bank eine Lastschrift zurück: Tag setzen, Klärungs-Aufgabe (Kunde kontaktieren, Bankverbindung/Mandat prüfen) und interne Info an die Admins. Keine automatische Nachricht an den Kunden.",
    objectType: "contact",
    definition: flow(
      { type: "debit.returned", config: {} },
      [
        { id: "tag", type: "action.add_tag", label: "Tag: Rücklastschrift", config: { tag: "rücklastschrift" } },
        { id: "aufgabe", type: "action.create_task", label: "Rücklastschrift klären", config: { title: "Rücklastschrift klären: Kunde kontaktieren, Mandat und Bankverbindung prüfen", dueDays: 1, assignTo: "owner" } },
        { id: "info", type: "action.notify_internal", label: "Admins informieren", config: { to: "workspace_admins", subject: "Rücklastschrift bei {{ contact.FIRSTNAME }} {{ contact.LASTNAME }}", body: "Eine Lastschrift wurde von der Bank zurückgegeben. Details und Rückgabegrund stehen an der Rechnung (Abo & Zahlung)." } },
        end(),
      ],
      { reenroll: true },
    ),
  },
  {
    key: "rechnung-bezahlt-danke",
    name: "Rechnung bezahlt → Dankeschön-Aufgabe + Lifecycle Kunde",
    description:
      "Ist eine Rechnung vollständig bezahlt (online, Überweisung, Lastschrift oder manuell): Lifecycle auf „Kunde“ (nur vorwärts) und eine Aufgabe, sich persönlich zu bedanken. Keine automatische Nachricht an den Kunden.",
    objectType: "contact",
    definition: flow(
      { type: "invoice.paid", config: {} },
      [
        { id: "kunde", type: "action.set_lifecycle", label: "Lifecycle: Kunde", config: { stage: "customer", onlyForward: true } },
        { id: "aufgabe", type: "action.create_task", label: "Dankeschön", config: { title: "Zahlung eingegangen – kurz persönlich bedanken", dueDays: 2, assignTo: "owner" } },
        end(),
      ],
      { reenroll: true },
    ),
  },
  {
    key: "abo-gekuendigt-rueckgewinnung",
    name: "Abo gekündigt → Rückgewinnungs-Aufgabe",
    description: "Wird ein Abo gekündigt (im CRM oder im Kundenportal): Tag setzen und eine Aufgabe, den Kündigungsgrund zu erfragen und ein Rückgewinnungs-Angebot zu prüfen.",
    objectType: "contact",
    definition: flow(
      { type: "subscription.cancelled", config: {} },
      [
        { id: "tag", type: "action.add_tag", label: "Tag: Abo gekündigt", config: { tag: "abo-gekündigt" } },
        { id: "aufgabe", type: "action.create_task", label: "Rückgewinnung", config: { title: "Rückgewinnung: Kündigungsgrund erfragen und Angebot prüfen", dueDays: 2, assignTo: "owner" } },
        end(),
      ],
      { reenroll: true },
    ),
  },
];

/** Platzhalter für sub-account-spezifische IDs in Vorlagen (beim Anlegen aufgelöst), z. B. "meetingType:Onboarding-Kickoff". */
export const MEETING_TYPE_REF = "meetingType:";

export function getTemplate(key: string) {
  return PROCESS_TEMPLATES.find((t) => t.key === key);
}

/** Eigene Felder, die die Vorlagen nutzen – werden mit den Standardprozessen angelegt (sonst existierten sie nicht). */
export const TEMPLATE_PROPERTIES: { objectType: ObjectType; key: string; label: string; type: "number" | "select"; options?: string[] }[] = [
  { objectType: "contact", key: "LEAD_SCORE", label: "Lead-Bewertung", type: "number" },
  { objectType: "contact", key: "ANLIEGEN", label: "Anliegen", type: "select", options: ["Angebot", "Termin", "Support", "Sonstiges"] },
];
