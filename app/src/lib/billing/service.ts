import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { emitEvent } from "../events";
import { audit } from "../audit";
import { requestApproval } from "../approvals";
import { computeTotals, formatCents, parseItems, type InvoiceItem } from "../invoice";
import { allocateNumber } from "../documents/numbering";
import { sendDocument, prepareDocumentMail, contextFor, paymentUrlFor } from "../documents/send";
import { renderDocText } from "../documents/texts";
import { isValidBic, isValidIban, normalizeIban } from "../compliance-validators";
import { addDays, cancellationEffectiveDate, dateOnly, duePeriods, isInterval, type Interval } from "./periods";
import { buildPain008, debitSequence, earliestCollectionDate, isValidCreditorId, storedSequence, isValidMandateRef, mandateRefFor, sepaText, type Pain008Tx } from "./sepa";
import { encryptIban, decryptIban } from "./crypto";
import { emitInvoicePaid } from "../payments/paid-event";
import { nextDunningLevel, parseDunningSettings, renderDunningPlaceholders, DUNNING_LABEL, type DunningSettings } from "./dunning";

// Abos, Abrechnungslauf, SEPA-Mandate/-Stapel und Mahnwesen. Akteur: user:<id> | system | process:<id>.

export class BillingError extends Error {}

const PRE_NOTIFICATION_DAYS = 14;
const today = () => dateOnly(new Date());
const day = (d: Date) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" }).format(d);

// ---------- Einstellungen (AppSetting, keine Schema-Änderung) ----------

const autosendKey = (subId: string) => `billing:autosend:${subId}`;
const dunningKey = (wsId: string) => `billing:dunning:${wsId}`;

export async function getAutoSend(subId: string): Promise<{ enabled: boolean; by?: string; at?: string }> {
  const s = await db.appSetting.findUnique({ where: { key: autosendKey(subId) } });
  const v = (s?.value ?? {}) as { enabled?: boolean; by?: string; at?: string };
  return { enabled: v.enabled === true, by: v.by, at: v.at };
}

/** Automatischen Versand nur durch Menschen einschalten (Aufrufer prüft invoices.edit). */
export async function setAutoSend(subId: string, enabled: boolean, actor: string) {
  if (!actor.startsWith("user:")) throw new BillingError("Automatischen Versand dürfen nur Menschen einschalten.");
  const value = { enabled, by: actor, at: new Date().toISOString() };
  await db.appSetting.upsert({ where: { key: autosendKey(subId) }, create: { key: autosendKey(subId), value }, update: { value } });
}

export async function getDunningSettings(wsId: string): Promise<DunningSettings> {
  const s = await db.appSetting.findUnique({ where: { key: dunningKey(wsId) } });
  return parseDunningSettings(s?.value);
}

export async function saveDunningSettings(wsId: string, value: DunningSettings) {
  const v = parseDunningSettings(value) as unknown as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key: dunningKey(wsId) }, create: { key: dunningKey(wsId), value: v }, update: { value: v } });
}

// ---------- Abos ----------

export type SubscriptionInput = {
  contactId: string;
  companyId?: string | null;
  items: InvoiceItem[];
  interval: Interval;
  startDate: Date;
  minTermMonths: number;
  noticePeriodDays: number;
  paymentMethod: "sepa" | "transfer";
  mandateId?: string | null;
  consumer: boolean;
};

export async function createSubscription(workspaceId: string, input: SubscriptionInput, actor: string) {
  if (!input.items.length) throw new BillingError("Mindestens eine Position.");
  const contact = await db.contact.findFirst({ where: { id: input.contactId, workspaceId } });
  if (!contact) throw new BillingError("Kontakt nicht gefunden.");
  if (input.companyId && !(await db.company.findFirst({ where: { id: input.companyId, workspaceId } }))) throw new BillingError("Unternehmen nicht gefunden.");
  if (input.paymentMethod === "sepa") {
    if (!input.mandateId) throw new BillingError("Für Lastschrift ist ein Mandat nötig.");
    const m = await db.sepaMandate.findFirst({ where: { id: input.mandateId, workspaceId, contactId: input.contactId, status: "active" } });
    if (!m) throw new BillingError("Mandat nicht gefunden, nicht aktiv oder gehört zu einem anderen Kontakt.");
  }
  // B2C: Mindestlaufzeit höchstens 24 Monate (§ 309 Nr. 9 a BGB), Kündigungsfrist höchstens 1 Monat
  if (input.consumer && input.minTermMonths > 24) throw new BillingError("Bei Verbrauchern ist eine Mindestlaufzeit von höchstens 24 Monaten zulässig.");
  if (input.consumer && input.noticePeriodDays > 30) throw new BillingError("Bei Verbrauchern beträgt die Kündigungsfrist höchstens einen Monat.");
  const start = dateOnly(input.startDate);
  return db.$transaction(async (tx) => {
    const sub = await tx.subscription.create({
      data: {
        workspaceId,
        contactId: input.contactId,
        companyId: input.companyId ?? contact.companyId ?? null,
        items: input.items as unknown as Prisma.InputJsonValue,
        interval: input.interval,
        startDate: start,
        nextBillingDate: start,
        minTermMonths: input.minTermMonths,
        noticePeriodDays: input.noticePeriodDays,
        paymentMethod: input.paymentMethod,
        mandateId: input.paymentMethod === "sepa" ? input.mandateId : null,
        consumer: input.consumer,
      },
    });
    await emitEvent({ workspaceId, type: "subscription.created", objectType: "contact", objectId: input.contactId, data: { subscriptionId: sub.id, interval: sub.interval } }, tx);
    await tx.activity.create({ data: { workspaceId, contactId: input.contactId, type: "SYSTEM", body: `Abo angelegt (${sub.interval})`, meta: { subscriptionId: sub.id } } });
    await audit({ workspaceId, actor, action: "subscription.created", target: sub.id });
    return sub;
  });
}

export async function cancelSubscription(workspaceId: string, id: string, actor: string, opts: { requestedAt?: Date; via?: "user" | "customer" } = {}) {
  const sub = await db.subscription.findFirst({ where: { id, workspaceId } });
  if (!sub) throw new BillingError("Abo nicht gefunden.");
  if (sub.status === "cancelled" || sub.status === "ended") return { sub, effective: sub.endDate, already: true };
  const requestedAt = opts.requestedAt ?? new Date();
  const effective = cancellationEffectiveDate({
    startDate: sub.startDate,
    interval: (isInterval(sub.interval) ? sub.interval : "monthly") as Interval,
    minTermMonths: sub.minTermMonths,
    noticePeriodDays: sub.noticePeriodDays,
    consumer: sub.consumer,
    requestedAt,
    nextBillingDate: sub.nextBillingDate,
  });
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.subscription.update({ where: { id: sub.id }, data: { status: "cancelled", cancelledAt: requestedAt, endDate: effective } });
    await emitEvent({ workspaceId, type: "subscription.cancelled", objectType: "contact", objectId: sub.contactId, data: { subscriptionId: sub.id, effective: effective.toISOString().slice(0, 10), via: opts.via ?? "user" } }, tx);
    await tx.activity.create({ data: { workspaceId, contactId: sub.contactId, type: "SYSTEM", body: `Abo gekündigt zum ${day(effective)}${opts.via === "customer" ? " (online durch Kunden)" : ""}`, meta: { subscriptionId: sub.id } } });
    return u;
  });
  await audit({ workspaceId, actor, action: "subscription.cancelled", target: sub.id, detail: { effective: effective.toISOString().slice(0, 10) } });
  return { sub: updated, effective, already: false };
}

export async function setSubscriptionPaused(workspaceId: string, id: string, paused: boolean, actor: string) {
  const r = await db.subscription.updateMany({ where: { id, workspaceId, status: paused ? "active" : "paused" }, data: { status: paused ? "paused" : "active" } });
  if (!r.count) throw new BillingError(paused ? "Nur aktive Abos lassen sich pausieren." : "Nur pausierte Abos lassen sich fortsetzen.");
  await audit({ workspaceId, actor, action: paused ? "subscription.paused" : "subscription.resumed", target: id });
}

// ---------- Abrechnungslauf ----------

function preNotificationText(amountCents: number, collectionDate: Date, mandateRef: string, creditorId: string | null) {
  return `Vorabankündigung SEPA-Lastschrift: Wir ziehen den Betrag von ${formatCents(amountCents)} am ${day(collectionDate)} von Ihrem Konto ein. Mandatsreferenz: ${mandateRef}${creditorId ? `, Gläubiger-ID: ${creditorId}` : ""}.`;
}

/**
 * Fällige Abo-Perioden abrechnen (idempotent je Abo und Periode über serviceFrom).
 * Rechnungen bleiben Entwurf (+ Aufgabe), außer ein Mensch hat „automatisch versenden“ eingeschaltet.
 */
export async function runBilling(workspaceId: string, onDate: Date = today()) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const subs = await db.subscription.findMany({
    where: { workspaceId, status: { in: ["active", "cancelled"] }, nextBillingDate: { lte: onDate } },
    include: { contact: true, mandate: true },
  });
  const created: string[] = [];
  for (const sub of subs) {
    const interval = (isInterval(sub.interval) ? sub.interval : "monthly") as Interval;
    const periods = duePeriods(sub.nextBillingDate, interval, sub.startDate.getUTCDate(), onDate);
    for (const p of periods) {
      if (sub.endDate && p.from > sub.endDate) {
        await db.subscription.update({ where: { id: sub.id }, data: { status: "ended" } });
        break;
      }
      const items = parseItems(sub.items);
      const to = sub.endDate && p.to > sub.endDate ? sub.endDate : p.to;
      const totals = computeTotals(items);
      const invoiceId = await db.$transaction(async (tx) => {
        const exists = await tx.invoice.findFirst({ where: { workspaceId, subscriptionId: sub.id, serviceFrom: p.from, status: { not: "CANCELLED" } }, select: { id: true } });
        if (exists) {
          await tx.subscription.update({ where: { id: sub.id }, data: { nextBillingDate: p.next } });
          return null;
        }
        const issue = dateOnly(onDate);
        const sepa = sub.paymentMethod === "sepa" && sub.mandate && sub.mandate.status === "active";
        const collection = sepa ? earliestCollectionDate(issue, issue, PRE_NOTIFICATION_DAYS) : null;
        const number = await allocateNumber(tx, workspaceId, "INVOICE", issue.getUTCFullYear());
        const buyer = sub.contact;
        const inv = await tx.invoice.create({
          data: {
            workspaceId,
            kind: "INVOICE",
            number,
            contactId: sub.contactId,
            issueDate: issue,
            dueDate: collection ?? addDays(issue, 14),
            items: items as unknown as Prisma.InputJsonValue,
            netCents: totals.netCents,
            vatCents: totals.vatCents,
            grossCents: totals.grossCents,
            buyerName: buyer.company || [buyer.firstName, buyer.lastName].filter(Boolean).join(" ") || buyer.email,
            buyerEmail: buyer.email,
            serviceFrom: p.from,
            serviceTo: to,
            subscriptionId: sub.id,
            paymentMethod: sepa ? "sepa" : "transfer",
            notes: sepa && collection ? preNotificationText(totals.grossCents, collection, sub.mandate!.mandateRef, ws.creditorId) : null,
          },
        });
        await tx.subscription.update({
          where: { id: sub.id },
          data: { nextBillingDate: p.next, ...(interval === "one_time" ? { status: "ended" } : {}) },
        });
        // Aufgabe in DERSELBEN Transaktion (LR-4): bricht der Lauf danach ab (Absturz vor/beim Versand), bleibt die
        // Rechnung sichtbar; der Neustart überspringt die Periode, sonst wäre sie still verloren.
        const task = await tx.task.create({ data: { workspaceId, title: "Abo-Rechnung prüfen und versenden", contactId: sub.contactId, ownerId: sub.contact.ownerId, dueAt: addDays(onDate, 1) } });
        return { id: inv.id, taskId: task.id };
      });
      if (!invoiceId) continue;
      created.push(invoiceId.id);
      const auto = await getAutoSend(sub.id);
      if (auto.enabled) {
        try {
          await sendDocument(workspaceId, invoiceId.id, "system:billing");
          // Automatisch versendet → Prüfaufgabe entfällt (wie bisher keine Aufgabe bei Autoversand)
          await db.task.deleteMany({ where: { id: invoiceId.taskId, doneAt: null } });
        } catch (e) {
          await db.task.updateMany({ where: { id: invoiceId.taskId }, data: { title: `Abo-Rechnung konnte nicht automatisch versendet werden: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`, ownerId: null } });
        }
      }
    }
  }
  // Gekündigte Abos nach Vertragsende beenden (letzte Periode ist oben bereits abgerechnet)
  await db.subscription.updateMany({ where: { workspaceId, status: "cancelled", endDate: { lt: onDate } }, data: { status: "ended" } });
  await expireMandates(workspaceId, onDate);
  return { created: created.length, invoiceIds: created };
}

// ---------- SEPA-Mandate ----------

export type MandateInput = { contactId: string; accountHolder: string; iban: string; bic?: string | null; scheme: "CORE" | "B1"; signedAt: Date };

export async function createMandate(workspaceId: string, input: MandateInput, actor: string) {
  const iban = normalizeIban(input.iban);
  if (!isValidIban(iban)) throw new BillingError("Die IBAN ist ungültig (Prüfziffer).");
  const bic = input.bic?.replace(/\s+/g, "").toUpperCase() || null;
  if (bic && !isValidBic(bic)) throw new BillingError("Der BIC ist ungültig.");
  if (!input.accountHolder.trim()) throw new BillingError("Kontoinhaber fehlt.");
  const contact = await db.contact.findFirst({ where: { id: input.contactId, workspaceId } });
  if (!contact) throw new BillingError("Kontakt nicht gefunden.");
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mandate:${workspaceId}`}))`;
    const year = new Date().getUTCFullYear();
    const count = await tx.sepaMandate.count({ where: { workspaceId } });
    let ref = mandateRefFor(ws.slug, year, count + 1);
    for (let i = 2; await tx.sepaMandate.findFirst({ where: { workspaceId, mandateRef: ref } }); i++) ref = mandateRefFor(ws.slug, year, count + i);
    if (!isValidMandateRef(ref)) throw new BillingError("Mandatsreferenz konnte nicht erzeugt werden.");
    const m = await tx.sepaMandate.create({
      data: {
        workspaceId,
        contactId: input.contactId,
        mandateRef: ref,
        accountHolder: input.accountHolder.trim().slice(0, 70),
        ibanEncrypted: encryptIban(iban),
        ibanLast4: iban.slice(-4),
        bic,
        scheme: input.scheme,
        signedAt: dateOnly(input.signedAt),
      },
    });
    await tx.activity.create({ data: { workspaceId, contactId: input.contactId, type: "SYSTEM", body: `SEPA-Mandat ${ref} erfasst`, meta: { mandateId: m.id } } });
    await audit({ workspaceId, actor, action: "mandate.created", target: m.id });
    return m;
  });
}

export async function revokeMandate(workspaceId: string, id: string, actor: string) {
  const r = await db.sepaMandate.updateMany({ where: { id, workspaceId, status: "active" }, data: { status: "revoked", revokedAt: new Date() } });
  if (!r.count) throw new BillingError("Mandat nicht aktiv.");
  await audit({ workspaceId, actor, action: "mandate.revoked", target: id });
}

/** Mandate verfallen, wenn 36 Monate keine Lastschrift eingezogen wurde (ab letzter Nutzung bzw. Unterschrift). */
export async function expireMandates(workspaceId: string, onDate: Date = today()) {
  const limit = new Date(Date.UTC(onDate.getUTCFullYear() - 3, onDate.getUTCMonth(), onDate.getUTCDate()));
  const r = await db.sepaMandate.updateMany({
    where: { workspaceId, status: "active", OR: [{ lastUsedAt: { lt: limit } }, { lastUsedAt: null, signedAt: { lt: limit } }] },
    data: { status: "expired" },
  });
  return r.count;
}

// ---------- Lastschrift-Stapel ----------

/** Rechnungen, die per Lastschrift eingezogen werden können (versendet = vorab angekündigt, nicht bereits im Einzug). */
export async function collectibleInvoices(workspaceId: string) {
  const list = await db.invoice.findMany({
    where: { workspaceId, kind: "INVOICE", paymentMethod: "sepa", status: "SENT" },
    include: { contact: true },
    orderBy: { dueDate: "asc" },
  });
  const busy = await db.directDebitItem.findMany({ where: { invoiceId: { in: list.map((i) => i.id) }, status: { in: ["pending", "collected"] } }, select: { invoiceId: true } });
  const busyIds = new Set(busy.map((b) => b.invoiceId));
  const result = [];
  for (const inv of list) {
    if (busyIds.has(inv.id)) continue;
    const mandate = await mandateForInvoice(workspaceId, inv.subscriptionId, inv.contactId);
    result.push({ invoice: inv, mandate });
  }
  return result;
}

async function mandateForInvoice(workspaceId: string, subscriptionId: string | null, contactId: string | null) {
  if (subscriptionId) {
    const sub = await db.subscription.findFirst({ where: { id: subscriptionId, workspaceId }, include: { mandate: true } });
    if (sub?.mandate?.status === "active") return sub.mandate;
  }
  if (!contactId) return null;
  return db.sepaMandate.findFirst({ where: { workspaceId, contactId, status: "active" }, orderBy: { signedAt: "desc" } });
}

export async function createDebitBatch(workspaceId: string, invoiceIds: string[], actor: string) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (!ws.creditorId || !isValidCreditorId(ws.creditorId)) throw new BillingError("Bitte zuerst eine gültige Gläubiger-ID in den Einstellungen hinterlegen.");
  if (!ws.iban || !isValidIban(ws.iban)) throw new BillingError("Bitte die eigene IBAN (Firmendaten) hinterlegen.");
  const collectible = await collectibleInvoices(workspaceId);
  const chosen = collectible.filter((c) => invoiceIds.includes(c.invoice.id));
  // Einmalige Abos → Einmallastschrift (OOFF)
  const subIds = [...new Set(chosen.map((c) => c.invoice.subscriptionId).filter((x): x is string => Boolean(x)))];
  const subs = subIds.length ? await db.subscription.findMany({ where: { id: { in: subIds }, workspaceId }, select: { id: true, interval: true } }) : [];
  const intervalOf = new Map(subs.map((x) => [x.id, x.interval]));
  if (!chosen.length) throw new BillingError("Keine einziehbaren Rechnungen ausgewählt.");
  const missing = chosen.filter((c) => !c.mandate);
  if (missing.length) throw new BillingError(`Kein aktives Mandat für: ${missing.map((m) => m.invoice.number).join(", ")}`);
  const submitDay = today();
  // Einzugsdatum: frühestens nach Vorlauf (1 TARGET2-Tag) und Vorabankündigung (Rechnungsdatum + 14 Tage), höchstens die Fälligkeit nicht unterschreiten
  let collection = submitDay;
  for (const c of chosen) {
    const e = earliestCollectionDate(submitDay, c.invoice.issueDate, PRE_NOTIFICATION_DAYS);
    const target = c.invoice.dueDate && c.invoice.dueDate > e ? c.invoice.dueDate : e;
    if (target > collection) collection = target;
  }
  const messageId = `PD-${submitDay.toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(5).toString("hex").toUpperCase()}`;
  return db.$transaction(async (tx) => {
    const batch = await tx.directDebitBatch.create({
      data: {
        workspaceId,
        collectionDate: collection,
        messageId,
        totalCents: chosen.reduce((s, c) => s + c.invoice.grossCents, 0),
        count: chosen.length,
        createdBy: actor,
      },
    });
    for (const c of chosen) {
      await tx.directDebitItem.create({
        data: {
          batchId: batch.id,
          invoiceId: c.invoice.id,
          mandateId: c.mandate!.id,
          amountCents: c.invoice.grossCents,
          sequence: debitSequence(c.mandate!.sequence, c.invoice.subscriptionId ? intervalOf.get(c.invoice.subscriptionId) : null),
          endToEndId: sepaText(c.invoice.number, 35).replace(/\s/g, ""),
        },
      });
    }
    await audit({ workspaceId, actor, action: "debit.batch_created", target: batch.id, detail: { count: chosen.length } });
    return batch;
  });
}

/** pain.008-XML eines Stapels erzeugen (deterministisch aus den gespeicherten Daten). Setzt Status exported. */
export async function exportDebitBatch(workspaceId: string, batchId: string, actor: string) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const batch = await db.directDebitBatch.findFirst({ where: { id: batchId, workspaceId }, include: { items: { include: { mandate: true } } } });
  if (!batch) throw new BillingError("Stapel nicht gefunden.");
  const invoices = await db.invoice.findMany({ where: { id: { in: batch.items.map((i) => i.invoiceId) }, workspaceId } });
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const txs: Pain008Tx[] = batch.items.map((it) => {
    const inv = invById.get(it.invoiceId)!;
    return {
      endToEndId: it.endToEndId,
      amountCents: it.amountCents,
      mandateRef: it.mandate.mandateRef,
      mandateSignedAt: it.mandate.signedAt,
      debtorName: it.mandate.accountHolder,
      debtorIban: decryptIban(it.mandate.ibanEncrypted),
      debtorBic: it.mandate.bic,
      remittance: `Rechnung ${inv.number}${inv.serviceFrom && inv.serviceTo ? ` Zeitraum ${day(inv.serviceFrom)}-${day(inv.serviceTo)}` : ""}`,
      sequence: storedSequence(it.sequence),
      scheme: it.mandate.scheme === "B1" ? "B2B" : "CORE",
    };
  });
  const xml = buildPain008({
    messageId: batch.messageId,
    createdAt: batch.createdAt,
    initiatorName: ws.legalName ?? ws.name,
    creditorName: ws.legalName ?? ws.name,
    creditorIban: ws.iban ?? "",
    creditorBic: ws.bic,
    creditorId: ws.creditorId ?? "",
    collectionDate: batch.collectionDate,
    transactions: txs,
  });
  if (batch.status === "draft") await db.directDebitBatch.update({ where: { id: batch.id }, data: { status: "exported" } });
  await audit({ workspaceId, actor, action: "debit.batch_exported", target: batch.id });
  return { xml, filename: `lastschrift-${batch.messageId}.xml` };
}

/** Nach Einreichung bei der Bank (Aufrufer prüft invoices.edit + approve). */
export async function markBatchSubmitted(workspaceId: string, batchId: string, actor: string) {
  const r = await db.directDebitBatch.updateMany({ where: { id: batchId, workspaceId, status: "exported" }, data: { status: "submitted" } });
  if (!r.count) throw new BillingError("Nur exportierte Stapel können als eingereicht markiert werden.");
  await audit({ workspaceId, actor, action: "debit.batch_submitted", target: batchId });
}

/** Einzug bestätigt (Gutschrift auf dem Konto): Rechnungen bezahlt, Mandate auf RCUR. Rückläufer vorher erfassen. */
export async function markBatchSettled(workspaceId: string, batchId: string, actor: string) {
  const batch = await db.directDebitBatch.findFirst({ where: { id: batchId, workspaceId, status: "submitted" }, include: { items: true } });
  if (!batch) throw new BillingError("Nur eingereichte Stapel können abgeschlossen werden.");
  await db.$transaction(async (tx) => {
    for (const it of batch.items.filter((i) => i.status === "pending")) {
      await tx.directDebitItem.update({ where: { id: it.id }, data: { status: "collected" } });
      const paid = await tx.invoice.updateMany({ where: { id: it.invoiceId, workspaceId, status: { notIn: ["PAID", "CANCELLED"] } }, data: { status: "PAID" } });
      if (paid.count) await emitInvoicePaid(tx, await tx.invoice.findUniqueOrThrow({ where: { id: it.invoiceId } }), { via: "sepa", method: "sepa_debit" });
      // Einmallastschrift (OOFF) ändert die Folge des Mandats nicht
      await tx.sepaMandate.update({ where: { id: it.mandateId }, data: it.sequence === "OOFF" ? { lastUsedAt: batch.collectionDate } : { sequence: "RCUR", lastUsedAt: batch.collectionDate } });
    }
    await tx.directDebitBatch.update({ where: { id: batch.id }, data: { status: "settled" } });
  });
  await audit({ workspaceId, actor, action: "debit.batch_settled", target: batchId });
}

/** Rücklastschrift erfassen: Rechnung wieder offen (Überweisung, neue Frist), Mahnwesen greift; MD01/AC04 → Mandat gesperrt. */
export async function recordReturn(workspaceId: string, itemId: string, reason: string, feeCents: number, actor: string) {
  const item = await db.directDebitItem.findFirst({ where: { id: itemId, batch: { workspaceId } }, include: { batch: true } });
  if (!item) throw new BillingError("Position nicht gefunden.");
  if (item.status === "returned") return;
  const inv = await db.invoice.findFirstOrThrow({ where: { id: item.invoiceId, workspaceId } });
  await db.$transaction(async (tx) => {
    await tx.directDebitItem.update({ where: { id: item.id }, data: { status: "returned", returnReason: `${reason}${feeCents > 0 ? ` (Gebühr ${formatCents(feeCents)})` : ""}`.slice(0, 200) } });
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "SENT", paymentMethod: "transfer", dueDate: addDays(today(), 7) } });
    if (["MD01", "AC04", "AC06"].includes(reason)) await tx.sepaMandate.update({ where: { id: item.mandateId }, data: { status: "revoked", revokedAt: new Date() } });
    await emitEvent({ workspaceId, type: "debit.returned", objectType: inv.contactId ? "contact" : "invoice", objectId: inv.contactId ?? inv.id, data: { invoiceId: inv.id, reason, feeCents } }, tx);
    if (inv.contactId) await tx.activity.create({ data: { workspaceId, contactId: inv.contactId, type: "SYSTEM", body: `Rücklastschrift zu ${inv.number}: ${reason}`, meta: { invoiceId: inv.id, feeCents } } });
  });
  await audit({ workspaceId, actor, action: "debit.returned", target: item.id, detail: { reason } });
}

// ---------- Mahnwesen ----------

/** Mahntext einer Stufe (personalisiert) – für Vorschau und Freigabe. */
export async function dunningDraft(workspaceId: string, invoiceId: string, level: number) {
  const s = await getDunningSettings(workspaceId);
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, workspaceId }, include: { contact: true } });
  if (!inv) throw new BillingError("Rechnung nicht gefunden.");
  const ctx = contextFor(ws, inv, null, { paymentUrl: await paymentUrlFor(inv) });
  const t = s.texts[String(level) as "1" | "2" | "3"];
  const fee = s.feeCents[level - 1] ?? 0;
  const base = await prepareDocumentMail(workspaceId, invoiceId, "system");
  return {
    to: base.to,
    subject: renderDocText(renderDunningPlaceholders(t.subject, level, fee), ctx).replace(/\s+/g, " ").trim(),
    body: renderDocText(renderDunningPlaceholders(t.body, level, fee), ctx).trim(),
  };
}

/**
 * Überfällige Rechnungen prüfen: nächste Mahnstufe als Freigabe-Anfrage (nie direkt versenden).
 * Rechnungen im Lastschrifteinzug werden ausgelassen. Erste Überfälligkeit → Ereignis invoice.overdue.
 */
export async function runDunning(workspaceId: string, onDate: Date = today()) {
  const s = await getDunningSettings(workspaceId);
  const overdue = await db.invoice.findMany({ where: { workspaceId, kind: "INVOICE", status: "SENT", dueDate: { lt: onDate } } });
  if (!overdue.length) return { requested: 0 };
  const inCollection = new Set(
    (await db.directDebitItem.findMany({ where: { invoiceId: { in: overdue.map((i) => i.id) }, status: "pending" }, select: { invoiceId: true } })).map((x) => x.invoiceId),
  );
  const pending = await db.approval.findMany({ where: { workspaceId, kind: "dunning.send", status: "pending" }, select: { payload: true } });
  const pendingKeys = new Set(pending.map((p) => `${(p.payload as { invoiceId?: string }).invoiceId}:${(p.payload as { level?: number }).level}`));
  let requested = 0;
  for (const inv of overdue) {
    const level = nextDunningLevel({ dueDate: inv.dueDate, level: inv.dunningLevel, dunnedAt: inv.dunnedAt, today: onDate, inCollection: inCollection.has(inv.id) }, s);
    if (!level || pendingKeys.has(`${inv.id}:${level}`)) continue;
    if (level === 1 && inv.dunningLevel === 0) {
      const already = await db.crmEvent.count({ where: { workspaceId, type: "invoice.overdue", data: { path: ["invoiceId"], equals: inv.id } } });
      if (!already) await emitEvent({ workspaceId, type: "invoice.overdue", objectType: inv.contactId ? "contact" : "invoice", objectId: inv.contactId ?? inv.id, data: { invoiceId: inv.id, number: inv.number, grossCents: inv.grossCents } });
    }
    const draft = await dunningDraft(workspaceId, inv.id, level).catch(() => null);
    await requestApproval({
      workspaceId,
      kind: "dunning.send",
      title: `${DUNNING_LABEL[level]} zu ${inv.number} senden`,
      summary: draft ? `An ${draft.to}: ${draft.subject}` : undefined,
      payload: { invoiceId: inv.id, level, ...(draft ?? {}) },
      requestedBy: "system:billing",
    });
    requested++;
  }
  return { requested };
}

/** Ausführung nach Freigabe: Mahnung mit Rechnungs-PDF senden, Stufe festhalten. */
export async function sendDunning(workspaceId: string, invoiceId: string, level: number, actor: string, draft?: { to?: string; subject?: string; body?: string }) {
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, workspaceId } });
  if (!inv) throw new BillingError("Rechnung nicht gefunden.");
  if (inv.status !== "SENT") throw new BillingError("Die Rechnung ist nicht mehr offen.");
  if (inv.dunningLevel >= level) return { skipped: true };
  const d = { ...(await dunningDraft(workspaceId, invoiceId, level)), ...Object.fromEntries(Object.entries(draft ?? {}).filter(([, v]) => typeof v === "string" && v)) };
  const r = await sendDocument(workspaceId, invoiceId, actor, d);
  await db.invoice.update({ where: { id: inv.id }, data: { dunningLevel: level, dunnedAt: new Date() } });
  if (inv.contactId) await db.activity.create({ data: { workspaceId, contactId: inv.contactId, type: "SYSTEM", body: `${DUNNING_LABEL[level]} zu ${inv.number} gesendet`, meta: { invoiceId: inv.id, level } } });
  return { skipped: false, emailId: r.emailId };
}
