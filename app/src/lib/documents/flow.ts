import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { emitEvent } from "../events";
import { audit } from "../audit";
import { allocateNumber } from "./numbering";

// Belegkette: Angebot (QUOTE) → angenommen → Auftragsbestätigung (ORDER) → Rechnung (INVOICE).
// Nutzbar aus UI, Prozessen und MCP. Akteur-Format: user:<id> | mcp:<keyId> | process:<runId> | customer:<token> | system

const today = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

export class DocumentFlowError extends Error {}

/** Angebot als angenommen markieren (idempotent). Erzeugt Ereignis quote.accepted. */
export async function acceptQuote(workspaceId: string, quoteId: string, actor: string, opts: { customerOrderRef?: string | null; via?: "user" | "customer" } = {}) {
  return db.$transaction(async (tx) => {
    const q = await tx.invoice.findFirst({ where: { id: quoteId, workspaceId, kind: "QUOTE" } });
    if (!q) throw new DocumentFlowError("Angebot nicht gefunden.");
    if (q.status === "CANCELLED") throw new DocumentFlowError("Das Angebot ist storniert.");
    if (q.status === "ACCEPTED") return { quote: q, alreadyAccepted: true };
    const ref = opts.customerOrderRef?.trim() || null;
    const updated = await tx.invoice.update({
      where: { id: q.id },
      data: { status: "ACCEPTED", ...(ref ? { customerOrderRef: ref.slice(0, 100) } : {}) },
    });
    await emitEvent(
      { workspaceId, type: "quote.accepted", objectType: "invoice", objectId: q.id, data: { contactId: q.contactId, number: q.number, grossCents: q.grossCents, via: opts.via ?? "user" } },
      tx,
    );
    if (q.contactId) {
      await tx.activity.create({
        data: { workspaceId, contactId: q.contactId, type: "SYSTEM", body: `Angebot ${q.number} angenommen${opts.via === "customer" ? " (online durch Kunden)" : ""}`, meta: { invoiceId: q.id } },
      });
    }
    await audit({ workspaceId, actor, action: "quote.accepted", target: q.id });
    return { quote: updated, alreadyAccepted: false };
  });
}

/**
 * Auftragsbestätigung aus einem Angebot erzeugen. Das Angebot wird dabei angenommen (falls noch nicht).
 * Pro Angebot nur eine aktive Auftragsbestätigung (nicht storniert).
 */
export async function createOrderFromQuote(workspaceId: string, quoteId: string, actor: string, opts: { customerOrderRef?: string | null } = {}) {
  const created = await db.$transaction(async (tx) => {
    const q = await tx.invoice.findFirst({ where: { id: quoteId, workspaceId, kind: "QUOTE" } });
    if (!q) throw new DocumentFlowError("Angebot nicht gefunden.");
    if (q.status === "CANCELLED") throw new DocumentFlowError("Aus einem stornierten Angebot kann keine Auftragsbestätigung entstehen.");
    const existing = await tx.invoice.findFirst({ where: { workspaceId, kind: "ORDER", fromQuoteId: q.id, status: { not: "CANCELLED" } } });
    if (existing) throw new DocumentFlowError(`Für dieses Angebot gibt es bereits die Auftragsbestätigung ${existing.number}.`);
    const ref = (opts.customerOrderRef?.trim() || q.customerOrderRef || null)?.slice(0, 100) ?? null;
    const date = today();
    const number = await allocateNumber(tx, workspaceId, "ORDER", date.getUTCFullYear());
    const order = await tx.invoice.create({
      data: {
        workspaceId, kind: "ORDER", number, contactId: q.contactId, issueDate: date, dueDate: null,
        items: q.items as Prisma.InputJsonValue, netCents: q.netCents, vatCents: q.vatCents, grossCents: q.grossCents, currency: q.currency,
        buyerName: q.buyerName, buyerAddress: q.buyerAddress, buyerEmail: q.buyerEmail, buyerReference: q.buyerReference,
        serviceFrom: q.serviceFrom, serviceTo: q.serviceTo, taxExemptionReason: q.taxExemptionReason, notes: q.notes,
        fromQuoteId: q.id, customerOrderRef: ref,
      },
    });
    if (q.status !== "ACCEPTED") {
      await tx.invoice.update({ where: { id: q.id }, data: { status: "ACCEPTED", ...(ref ? { customerOrderRef: ref } : {}) } });
      await emitEvent({ workspaceId, type: "quote.accepted", objectType: "invoice", objectId: q.id, data: { contactId: q.contactId, number: q.number, grossCents: q.grossCents, via: "order" } }, tx);
    }
    await emitEvent(
      { workspaceId, type: "order.created", objectType: "invoice", objectId: order.id, data: { contactId: q.contactId, quoteId: q.id, number, grossCents: q.grossCents } },
      tx,
    );
    if (q.contactId) {
      await tx.activity.create({ data: { workspaceId, contactId: q.contactId, type: "SYSTEM", body: `Auftragsbestätigung ${number} zu Angebot ${q.number} erstellt`, meta: { invoiceId: order.id } } });
    }
    return order;
  });
  await audit({ workspaceId, actor, action: "order.created", target: created.id, detail: { quoteId } });
  return created;
}

/** Rechnung aus Angebot oder Auftragsbestätigung erzeugen (Entwurf, 14 Tage Zahlungsziel). */
export async function createInvoiceFrom(workspaceId: string, sourceId: string, actor: string) {
  const created = await db.$transaction(async (tx) => {
    const src = await tx.invoice.findFirst({ where: { id: sourceId, workspaceId, kind: { in: ["QUOTE", "ORDER"] } } });
    if (!src) throw new DocumentFlowError("Ausgangsbeleg nicht gefunden.");
    if (src.status === "CANCELLED") throw new DocumentFlowError("Aus einem stornierten Beleg kann keine Rechnung entstehen.");
    const quoteId = src.kind === "QUOTE" ? src.id : src.fromQuoteId;
    const orderId = src.kind === "ORDER" ? src.id : null;
    const dup = await tx.invoice.findFirst({
      where: { workspaceId, kind: "INVOICE", status: { not: "CANCELLED" }, ...(orderId ? { fromOrderId: orderId } : { fromQuoteId: quoteId, fromOrderId: null }) },
    });
    if (dup) throw new DocumentFlowError(`Dazu gibt es bereits die Rechnung ${dup.number}.`);
    const date = today();
    const number = await allocateNumber(tx, workspaceId, "INVOICE", date.getUTCFullYear());
    const inv = await tx.invoice.create({
      data: {
        workspaceId, kind: "INVOICE", number, contactId: src.contactId, issueDate: date, dueDate: new Date(date.getTime() + 14 * 864e5),
        items: src.items as Prisma.InputJsonValue, netCents: src.netCents, vatCents: src.vatCents, grossCents: src.grossCents, currency: src.currency,
        buyerName: src.buyerName, buyerAddress: src.buyerAddress, buyerEmail: src.buyerEmail, buyerReference: src.buyerReference,
        serviceFrom: src.serviceFrom, serviceTo: src.serviceTo, taxExemptionReason: src.taxExemptionReason, notes: src.notes,
        fromQuoteId: quoteId, fromOrderId: orderId, customerOrderRef: src.customerOrderRef,
      },
    });
    if (src.kind === "QUOTE" && src.status !== "ACCEPTED") {
      await tx.invoice.update({ where: { id: src.id }, data: { status: "ACCEPTED" } });
      await emitEvent({ workspaceId, type: "quote.accepted", objectType: "invoice", objectId: src.id, data: { contactId: src.contactId, number: src.number, grossCents: src.grossCents, via: "invoice" } }, tx);
    }
    return inv;
  });
  await audit({ workspaceId, actor, action: "invoice.created_from", target: created.id, detail: { sourceId } });
  return created;
}

/** Belegkette zu einem Beleg: Angebot, Auftragsbestätigung(en), Rechnung(en). */
export async function documentChain(workspaceId: string, id: string) {
  const doc = await db.invoice.findFirst({ where: { id, workspaceId }, select: { id: true, kind: true, fromQuoteId: true, fromOrderId: true } });
  if (!doc) return [];
  let quoteId: string | null = doc.kind === "QUOTE" ? doc.id : doc.fromQuoteId;
  if (!quoteId && doc.fromOrderId) {
    quoteId = (await db.invoice.findFirst({ where: { id: doc.fromOrderId, workspaceId }, select: { fromQuoteId: true } }))?.fromQuoteId ?? null;
  }
  const orderIds = doc.kind === "ORDER" ? [doc.id] : [];
  const or: Prisma.InvoiceWhereInput[] = [{ id: doc.id }];
  if (quoteId) or.push({ id: quoteId }, { fromQuoteId: quoteId });
  if (doc.fromOrderId) or.push({ id: doc.fromOrderId }, { fromOrderId: doc.fromOrderId });
  for (const oid of orderIds) or.push({ fromOrderId: oid });
  const list = await db.invoice.findMany({
    where: { workspaceId, OR: or },
    select: { id: true, kind: true, number: true, status: true, issueDate: true, grossCents: true, currency: true },
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
  });
  const rank: Record<string, number> = { QUOTE: 0, ORDER: 1, INVOICE: 2 };
  return list.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9));
}
