// Kurze, lesbare Zusammenfassungen für Knoten und Auslöser auf der Arbeitsfläche.
import { CONDITION_OPS, NODE_TYPES, TRIGGER_TYPES, type Condition, type ConditionGroup, type ProcessDefinition, type ProcessNode } from "@/lib/process/definition";
import { OPTION_LABELS } from "./form";

export type Lookup = { label: (kind: "list" | "stage" | "lifecycle" | "template" | "webhook" | "user" | "form" | "field" | "meetingType", value: string) => string };

const plain: Lookup = { label: (_k, v) => v };

function short(s: unknown, max = 60): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function conditionText(c: Condition, l: Lookup = plain): string {
  const val = Array.isArray(c.value) ? c.value.join(", ") : c.value === undefined ? "" : String(c.value);
  return `${l.label("field", c.field)} ${CONDITION_OPS[c.op]}${val ? ` ${short(val, 30)}` : ""}`;
}

export function groupText(g: ConditionGroup | undefined, l: Lookup = plain): string {
  if (!g || g.conditions.length === 0) return "immer";
  const parts = g.conditions.map((c) => conditionText(c, l));
  return parts.length === 1 ? parts[0] : `${parts.length} Bedingungen (${g.match === "all" ? "alle" : "eine davon"})`;
}

export function nodeSummary(n: ProcessNode, l: Lookup = plain): string {
  const c = n.config as Record<string, unknown>;
  switch (n.type) {
    case "action.set_property":
      return `${l.label("field", String(c.field ?? ""))} = ${c.value === null ? "leer" : short(c.value, 30)}`;
    case "action.set_lifecycle":
      return `→ ${l.label("lifecycle", String(c.stage ?? ""))}${c.onlyForward ? " (nur vorwärts)" : ""}`;
    case "action.add_tag":
    case "action.remove_tag":
      return `Tag „${short(c.tag, 30)}“`;
    case "action.add_to_list":
    case "action.remove_from_list":
      return `Liste: ${l.label("list", String(c.listId ?? ""))}`;
    case "action.associate_company":
      return c.createIfMissing ? "zuordnen, bei Bedarf anlegen" : "nur vorhandene zuordnen";
    case "action.assign_owner":
      return OPTION_LABELS[String(c.strategy)] ?? "";
    case "action.create_task":
      return `„${short(c.title, 40)}“, fällig in ${c.dueDays ?? 0} Tag(en)`;
    case "action.create_deal":
      return `„${short(c.title, 40)}“`;
    case "action.create_ticket":
      return `„${short(c.subject, 40)}“ · ${OPTION_LABELS[String(c.priority)] ?? ""}`;
    case "action.set_stage":
      return l.label("stage", String(c.stageId ?? ""));
    case "action.notify_internal":
      return `an ${OPTION_LABELS[String(c.to)] ?? ""}: ${short(c.subject, 30)}`;
    case "action.send_email":
      return `${c.templateId ? l.label("template", String(c.templateId)) : short(c.subject, 40) || "ohne Betreff"} · ${c.mode === "marketing" ? "Marketing" : "transaktional"}`;
    case "action.send_channel_message":
      return `${c.channel === "sms" ? "SMS" : "WhatsApp"}: ${c.templateName ? `Vorlage „${short(c.templateName, 30)}“` : short(c.text, 40) || "ohne Text"} · ${c.purpose === "marketing" ? "Marketing" : "transaktional"}`;
    case "action.webhook":
      return l.label("webhook", String(c.webhookId ?? ""));
    case "action.create_order_confirmation":
      return c.quoteSource === "latest_accepted" ? "aus jüngstem angenommenen Angebot" : "aus dem angenommenen Angebot";
    case "action.create_invoice_from_order":
      return c.orderSource === "event" ? "aus AB des Ereignisses" : "aus AB des vorherigen Schritts";
    case "action.send_document":
      return `${OPTION_LABELS[String(c.document)] ?? "Beleg"} mit PDF${c.withAcceptLink ? " + Annahme-Link" : ""}`;
    case "action.schedule_meeting":
      return `${l.label("meetingType", String(c.meetingTypeId ?? ""))} · frühestens in ${c.afterWorkdays ?? 2} Werktagen (Freigabe)`;
    case "ai.classify":
      return `→ ${l.label("field", String(c.target ?? ""))} (${(c.categories as string[] | undefined)?.length ?? 0} Kategorien)`;
    case "ai.extract":
      return `${(c.fields as unknown[] | undefined)?.length ?? 0} Angaben → ${OPTION_LABELS[String(c.target)] ?? ""}`;
    case "ai.score":
      return `${(c.rules as unknown[] | undefined)?.length ?? 0} Regeln${c.useAi ? " + KI" : ""}`;
    case "logic.if":
      return groupText(c as unknown as ConditionGroup, l);
    case "logic.wait":
      return `${c.amount ?? "?"} ${OPTION_LABELS[String(c.unit)] ?? ""}`;
    case "logic.wait_until":
      return `${groupText(c.until as ConditionGroup, l)} · max. ${c.timeoutDays ?? "?"} Tage`;
    case "logic.end":
      return "";
    default:
      return NODE_TYPES[n.type as keyof typeof NODE_TYPES]?.label ?? "";
  }
}

export function triggerSummary(def: ProcessDefinition, l: Lookup = plain): { title: string; summary: string } {
  const t = TRIGGER_TYPES[def.trigger.type];
  const c = def.trigger.config as Record<string, unknown>;
  const bits: string[] = [];
  if (c.formId) bits.push(`Formular: ${l.label("form", String(c.formId))}`);
  if (c.tag) bits.push(`Tag „${short(c.tag, 30)}“`);
  if (c.listId) bits.push(`Liste: ${l.label("list", String(c.listId))}`);
  if (c.stageId) bits.push(`Phase: ${l.label("stage", String(c.stageId))}`);
  if (c.stage) bits.push(`Phase: ${l.label("lifecycle", String(c.stage))}`);
  if (c.field) bits.push(`Feld: ${l.label("field", String(c.field))}`);
  if (c.event) bits.push(`Ereignis: ${String(c.event)}`);
  const filters = def.enrollment.filters.conditions.length ? `Nur wenn: ${groupText(def.enrollment.filters, l)}` : "";
  return { title: t.label, summary: [bits.join(" · "), filters].filter(Boolean).join(" – ") || "für alle passenden Datensätze" };
}
