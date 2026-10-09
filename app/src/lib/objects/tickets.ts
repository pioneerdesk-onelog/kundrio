import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { emitEvent } from "../events";
import { ensureObjectDefaults } from "./defaults";
import { SLA_HOURS } from "./lifecycle";

type Tx = Prisma.TransactionClient;

export type TicketInput = {
  subject: string;
  description?: string | null;
  priority?: "low" | "medium" | "high" | "urgent";
  source?: string;
  contactId?: string | null;
  companyId?: string | null;
  ownerId?: string | null;
  stageId?: string | null;
  /** Stunden bis SLA-Frist; Standard nach Priorität */
  slaHours?: number | null;
};

/** Standard-Ticket-Pipeline des Workspaces (legt sie bei Bedarf an). */
export async function defaultTicketPipeline(workspaceId: string) {
  await ensureObjectDefaults(workspaceId);
  return db.pipeline.findFirstOrThrow({
    where: { workspaceId, objectType: "ticket" },
    orderBy: { createdAt: "asc" },
    include: { stages: { orderBy: { position: "asc" } } },
  });
}

/**
 * Ticket anlegen inkl. Ereignis ticket.created – nutzbar aus UI, Prozessen und MCP.
 * Referenzen (Kontakt, Unternehmen, Phase) werden gegen den Workspace geprüft.
 */
export async function createTicket(workspaceId: string, input: TicketInput, tx?: Tx) {
  const pipeline = await defaultTicketPipeline(workspaceId);
  const run = async (t: Tx) => {
    const stage = input.stageId
      ? await t.stage.findFirst({ where: { id: input.stageId, pipeline: { workspaceId, objectType: "ticket" } } })
      : pipeline.stages[0];
    if (!stage) throw new Error("Ticket-Status nicht gefunden");
    if (input.contactId && !(await t.contact.findFirst({ where: { id: input.contactId, workspaceId }, select: { id: true } }))) throw new Error("Kontakt nicht gefunden");
    if (input.companyId && !(await t.company.findFirst({ where: { id: input.companyId, workspaceId }, select: { id: true } }))) throw new Error("Unternehmen nicht gefunden");
    let companyId = input.companyId ?? null;
    if (!companyId && input.contactId) companyId = (await t.contact.findUnique({ where: { id: input.contactId }, select: { companyId: true } }))?.companyId ?? null;
    const priority = input.priority ?? "medium";
    const hours = input.slaHours ?? SLA_HOURS[priority];
    const ticket = await t.ticket.create({
      data: {
        workspaceId,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        subject: input.subject.trim().slice(0, 300),
        description: input.description?.slice(0, 20_000) ?? null,
        priority,
        source: input.source ?? "manual",
        contactId: input.contactId ?? null,
        companyId,
        ownerId: input.ownerId ?? null,
        slaDueAt: hours ? new Date(Date.now() + hours * 3600_000) : null,
        closedAt: stage.kind === "CLOSED" ? new Date() : null,
      },
    });
    if (ticket.contactId) {
      await t.activity.create({ data: { workspaceId, contactId: ticket.contactId, type: "SYSTEM", body: `Ticket #${ticket.numericId} „${ticket.subject}“ angelegt`, meta: { ticketId: ticket.id } } });
    }
    await emitEvent({ workspaceId, type: "ticket.created", objectType: "ticket", objectId: ticket.id, data: { stageId: stage.id, priority, source: ticket.source, contactId: ticket.contactId, companyId } }, t);
    return ticket;
  };
  return tx ? run(tx) : db.$transaction(run);
}

/** Status wechseln inkl. closedAt/firstResponseAt und Ereignis ticket.stage_changed. */
export async function moveTicket(workspaceId: string, ticketId: string, stageId: string) {
  return db.$transaction(async (tx) => {
    const [ticket, stage] = await Promise.all([
      tx.ticket.findFirst({ where: { id: ticketId, workspaceId }, include: { stage: true, pipeline: { include: { stages: { orderBy: { position: "asc" } } } } } }),
      tx.stage.findFirst({ where: { id: stageId, pipeline: { workspaceId, objectType: "ticket" } } }),
    ]);
    if (!ticket || !stage) throw new Error("Ticket oder Status nicht gefunden");
    if (stage.pipelineId !== ticket.pipelineId) throw new Error("Status gehört zu einer anderen Pipeline");
    if (stage.id === ticket.stageId) return ticket;
    const firstStageId = ticket.pipeline.stages[0]?.id;
    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        stageId: stage.id,
        closedAt: stage.kind === "CLOSED" ? new Date() : null,
        // Erste Reaktion = erster Wechsel weg vom Eingangsstatus
        firstResponseAt: ticket.firstResponseAt ?? (ticket.stageId === firstStageId ? new Date() : null),
      },
    });
    if (ticket.contactId) {
      await tx.activity.create({ data: { workspaceId, contactId: ticket.contactId, type: "SYSTEM", body: `Ticket #${ticket.numericId}: ${ticket.stage.name} → ${stage.name}`, meta: { ticketId: ticket.id } } });
    }
    await emitEvent({ workspaceId, type: "ticket.stage_changed", objectType: "ticket", objectId: ticket.id, data: { stageId: stage.id, fromStageId: ticket.stageId, closed: stage.kind === "CLOSED" } }, tx);
    return updated;
  });
}
