import type { ProcessDefinition } from "./definition";

/** Prüft die Auslöser-Konfiguration gegen die Ereignisdaten. */
export function triggerMatches(def: ProcessDefinition, ev: { type: string; data: unknown }): boolean {
  if (def.trigger.type !== ev.type) return false;
  const c = def.trigger.config as Record<string, unknown>;
  const d = (ev.data ?? {}) as Record<string, unknown>;
  // Importe (HubSpot, CSV, Brevo) erzeugen massenhaft Ereignisse mit data.import = true.
  // Sie lösen standardmäßig KEINE Prozesse aus (sonst z. B. Willkommensmails an Bestandskontakte),
  // außer der Auslöser erlaubt es ausdrücklich mit { includeImports: true }.
  if (d.import === true && c.includeImports !== true) return false;
  const same = (key: string, dataKey = key) => !c[key] || String(c[key]).toLowerCase() === String(d[dataKey] ?? "").toLowerCase();
  switch (def.trigger.type) {
    case "form.submitted":
    case "consent.confirmed":
      return same("formId");
    case "contact.tag_added":
      return same("tag");
    case "contact.list_added":
      return same("listId");
    case "contact.property_changed":
      return same("field");
    case "contact.lifecycle_changed":
      return same("stage", "to");
    case "deal.stage_changed":
    case "ticket.stage_changed":
      return same("stageId") && same("fromStageId");
    case "email.event":
      return same("event");
    case "invoice.sent":
      return same("kind");
    case "meeting.scheduled":
    case "meeting.booked":
      return same("meetingTypeId");
    case "conversation.message_received":
      // Standard: nur neue Gespräche, außer der Auslöser will jede Nachricht ({ everyMessage: true })
      return same("channel") && same("inboxId") && (c.everyMessage === true || d.newConversation === true);
    case "debit.returned":
      return same("reason");
    case "invoice.paid":
      return same("via");
    default:
      return true;
  }
}


/** Beleg-Ereignisse: am Beleg (objectType "invoice") erzeugt, eingeschrieben wird der Kontakt (data.contactId). */
export const DOCUMENT_EVENT_TYPES = ["quote.accepted", "order.created", "invoice.sent"] as const;

export type EventSubject = { objectType: string; objectId: string; extra: Record<string, unknown> };

/**
 * Bestimmt, welcher Datensatz für ein Ereignis eingeschrieben wird.
 * - Beleg-Ereignisse → Kontakt des Belegs; Beleg-IDs werden als Ereignisdaten mitgegeben
 *   (invoiceId, quoteId, orderId). Ohne Kontakt → null (nichts starten, Ereignis gilt als verarbeitet).
 * - alle anderen → das Objekt des Ereignisses selbst.
 */
export function eventSubject(ev: { type: string; objectType: string; objectId: string; data: unknown }): EventSubject | null {
  const d = (ev.data ?? {}) as Record<string, unknown>;
  if (ev.objectType !== "invoice") return { objectType: ev.objectType, objectId: ev.objectId, extra: {} };
  const contactId = typeof d.contactId === "string" && d.contactId ? d.contactId : null;
  if (!contactId) return null;
  const extra: Record<string, unknown> = { invoiceId: ev.objectId };
  if (ev.type === "quote.accepted") extra.quoteId = ev.objectId;
  if (ev.type === "order.created") extra.orderId = ev.objectId;
  if (ev.type === "invoice.sent") {
    if (d.kind === "QUOTE") extra.quoteId = ev.objectId;
    if (d.kind === "ORDER") extra.orderId = ev.objectId;
  }
  return { objectType: "contact", objectId: contactId, extra };
}
