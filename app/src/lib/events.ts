import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "./db";

// Transaktionale Outbox: Jede fachliche Änderung schreibt ein Ereignis – möglichst in DERSELBEN
// Transaktion wie die Änderung (tx übergeben). Der Worker verteilt Ereignisse an Prozesse
// (siehe src/lib/process/engine.ts). So geht bei Abstürzen nichts verloren.

export type EventType =
  | "contact.created"
  | "contact.property_changed"
  | "contact.lifecycle_changed"
  | "contact.tag_added"
  | "contact.list_added"
  | "form.submitted"
  | "consent.confirmed"
  | "agent.request"
  | "email.event"
  | "company.created"
  | "company.property_changed"
  | "deal.created"
  | "deal.stage_changed"
  | "ticket.created"
  | "ticket.stage_changed"
  | "mention.found"
  // Belege (Angebot, Auftragsbestätigung, Rechnung) – objectType "invoice", data.contactId falls vorhanden
  | "quote.accepted"
  | "order.created"
  | "invoice.sent"
  // Eigene Domain: Status gewechselt (data: { hostname, from, to }) – objectType "domain"
  | "domain.status_changed"
  // Termin mit Kunden geplant (objectType "contact" = erster eingeladener Kontakt, data.eventId)
  | "meeting.scheduled"
  | "meeting.booked"
  // Posteingang: neue eingehende Nachricht (objectType "contact"; data: { conversationId, inboxId, channel, newConversation })
  | "conversation.message_received"
  // Abos & SEPA (objectType "contact" bzw. "invoice"; data: { subscriptionId } / { invoiceId, reason })
  | "subscription.created"
  | "subscription.cancelled"
  | "invoice.overdue"
  | "invoice.paid"
  | "debit.returned";

export type EventInput = {
  workspaceId: string;
  type: EventType;
  objectType: "contact" | "company" | "deal" | "ticket" | "invoice" | "domain";
  objectId: string;
  /** z. B. { formId }, { tag }, { field, from, to }, { stageId, fromStageId } – keine Geheimnisse */
  data?: Record<string, unknown>;
};

type Tx = Prisma.TransactionClient | PrismaClient;

export async function emitEvent(input: EventInput, tx: Tx = db) {
  await tx.crmEvent.create({
    data: {
      workspaceId: input.workspaceId,
      type: input.type,
      objectType: input.objectType,
      objectId: input.objectId,
      data: (input.data ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/** Mehrere Ereignisse auf einmal (z. B. Import). */
export async function emitEvents(inputs: EventInput[], tx: Tx = db) {
  if (inputs.length === 0) return;
  await tx.crmEvent.createMany({
    data: inputs.map((i) => ({
      workspaceId: i.workspaceId,
      type: i.type,
      objectType: i.objectType,
      objectId: i.objectId,
      data: (i.data ?? {}) as Prisma.InputJsonValue,
    })),
  });
}
