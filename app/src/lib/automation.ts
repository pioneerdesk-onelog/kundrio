import "server-only";
import { emitEvent, type EventInput } from "./events";
import { errMessage, log } from "@/lib/log";

// Bisherige Trigger-Schnittstelle (Formulare, DOI, Tags, Pipeline, KI-Agent).
// Seit Welle 4 schreibt sie Ereignisse in die Outbox; die Prozess-Engine verteilt sie.

export type Trigger = "FORM_SUBMITTED" | "TAG_ADDED" | "DEAL_STAGE_CHANGED" | "AGENT_REQUEST" | "CONSENT_CONFIRMED";

type Ctx = { contactId?: string; formId?: string; tag?: string; stageId?: string; dealId?: string; fromStageId?: string };

function toEvent(workspaceId: string, trigger: Trigger, ctx: Ctx): EventInput | null {
  switch (trigger) {
    case "FORM_SUBMITTED":
      return ctx.contactId ? { workspaceId, type: "form.submitted", objectType: "contact", objectId: ctx.contactId, data: { formId: ctx.formId } } : null;
    case "CONSENT_CONFIRMED":
      return ctx.contactId ? { workspaceId, type: "consent.confirmed", objectType: "contact", objectId: ctx.contactId, data: { formId: ctx.formId } } : null;
    case "TAG_ADDED":
      return ctx.contactId ? { workspaceId, type: "contact.tag_added", objectType: "contact", objectId: ctx.contactId, data: { tag: ctx.tag } } : null;
    case "AGENT_REQUEST":
      return ctx.contactId ? { workspaceId, type: "agent.request", objectType: "contact", objectId: ctx.contactId } : null;
    case "DEAL_STAGE_CHANGED":
      return ctx.dealId
        ? { workspaceId, type: "deal.stage_changed", objectType: "deal", objectId: ctx.dealId, data: { stageId: ctx.stageId, fromStageId: ctx.fromStageId, contactId: ctx.contactId } }
        : null;
  }
}

/** Schreibt das passende Ereignis in die Outbox. Darf nie werfen und den Request nicht blockieren. */
export async function fireTrigger(workspaceId: string, trigger: Trigger, ctx: Ctx): Promise<void> {
  try {
    const ev = toEvent(workspaceId, trigger, ctx);
    if (ev) await emitEvent(ev);
  } catch (e) {
    log.error("outbox write failed", { trigger, error: errMessage(e) });
  }
}
