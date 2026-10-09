"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, hasSpecial } from "@/lib/permissions";
import { guard, guardOrRedirect } from "@/lib/permissions/guard";
import { computeTotals, itemSchema } from "@/lib/invoice";
import { allocateNumber } from "@/lib/documents/numbering";
import { emitInvoicePaid } from "@/lib/payments/paid-event";
import { acceptQuote, createInvoiceFrom, createOrderFromQuote, DocumentFlowError } from "@/lib/documents/flow";

export type InvoiceState = { error?: string };

const schema = z.object({
  kind: z.enum(["QUOTE", "ORDER", "INVOICE"]),
  contactId: z.string().max(40).optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum fehlt"),
  dueDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  buyerName: z.string().trim().min(1, "Name des Empfängers fehlt").max(200),
  buyerAddress: z.string().trim().max(500),
  buyerReference: z.string().trim().max(100),
  buyerEmail: z.union([z.literal(""), z.email("E-Mail des Empfängers ist ungültig").max(254)]),
  serviceFrom: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  serviceTo: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  taxExemptionReason: z.string().trim().max(300),
  notes: z.string().trim().max(2000),
  customerOrderRef: z.string().trim().max(100),
  introText: z.string().max(4000),
  outroText: z.string().max(4000),
  items: z.array(itemSchema).min(1, "Mindestens eine Position").max(200),
});

const asDate = (s: string) => new Date(`${s}T00:00:00Z`);

export async function saveInvoice(slug: string, id: string | null, _prev: InvoiceState, formData: FormData): Promise<InvoiceState> {
  let ws;
  try {
    ({ ws } = await guard(slug, { object: "invoices", action: "edit" }));
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  let items: unknown;
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Positionen konnten nicht gelesen werden." };
  }
  const parsed = schema.safeParse({
    kind: formData.get("kind"),
    contactId: String(formData.get("contactId") ?? "") || undefined,
    issueDate: formData.get("issueDate"),
    dueDate: String(formData.get("dueDate") ?? ""),
    buyerName: String(formData.get("buyerName") ?? ""),
    buyerAddress: String(formData.get("buyerAddress") ?? ""),
    buyerReference: String(formData.get("buyerReference") ?? ""),
    buyerEmail: String(formData.get("buyerEmail") ?? "").trim(),
    serviceFrom: String(formData.get("serviceFrom") ?? ""),
    serviceTo: String(formData.get("serviceTo") ?? ""),
    taxExemptionReason: String(formData.get("taxExemptionReason") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    customerOrderRef: String(formData.get("customerOrderRef") ?? ""),
    // „Standardtext verwenden“ → leer speichern, dann greift der Text aus „Texte & Vorlagen“
    introText: formData.get("introDefault") === "on" ? "" : String(formData.get("introText") ?? ""),
    outroText: formData.get("outroDefault") === "on" ? "" : String(formData.get("outroText") ?? ""),
    items,
  });
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { error: i.path[0] === "items" && i.path.length > 1 ? `Position ${Number(i.path[1]) + 1}: ${i.message}` : i.message };
  }
  const d = parsed.data;
  if (d.serviceTo && !d.serviceFrom) return { error: "Leistungszeitraum: bitte auch den Beginn angeben." };
  if (d.serviceFrom && d.serviceTo && d.serviceTo < d.serviceFrom) return { error: "Leistungszeitraum: Ende liegt vor dem Beginn." };
  if (d.items.some((it) => it.vatRate === 0) && !d.taxExemptionReason) {
    return { error: "Bei Positionen mit 0 % USt bitte den Grund der Steuerbefreiung angeben (z. B. § 4 Nr. … UStG oder Reverse-Charge)." };
  }
  if (d.contactId) {
    const ok = await db.contact.findFirst({ where: { id: d.contactId, workspaceId: ws.id }, select: { id: true } });
    if (!ok) return { error: "Kontakt gehört nicht zu diesem Sub-Account." };
  }
  const totals = computeTotals(d.items);
  const data = {
    contactId: d.contactId ?? null,
    issueDate: asDate(d.issueDate),
    dueDate: d.dueDate ? asDate(d.dueDate) : null,
    buyerName: d.buyerName,
    buyerAddress: d.buyerAddress || null,
    buyerReference: d.buyerReference || null,
    buyerEmail: d.buyerEmail ? d.buyerEmail.toLowerCase() : null,
    serviceFrom: d.serviceFrom ? asDate(d.serviceFrom) : null,
    serviceTo: d.serviceTo ? asDate(d.serviceTo) : null,
    taxExemptionReason: d.taxExemptionReason || null,
    notes: d.notes || null,
    customerOrderRef: d.customerOrderRef || null,
    introText: d.introText.trim() ? d.introText : null,
    outroText: d.outroText.trim() ? d.outroText : null,
    items: d.items as unknown as Prisma.InputJsonValue,
    netCents: totals.netCents,
    vatCents: totals.vatCents,
    grossCents: totals.grossCents,
  };

  let targetId = id;
  if (id) {
    const existing = await db.invoice.findFirst({ where: { id, workspaceId: ws.id } });
    if (!existing) return { error: "Beleg nicht gefunden." };
    // Versendete Rechnungen sind unveränderlich (GoBD) – stornieren statt ändern; ebenso versendete Auftragsbestätigungen
    if (existing.kind === "INVOICE" && existing.status !== "DRAFT") return { error: "Versendete Rechnungen können nicht geändert werden. Bitte stornieren und neu erstellen." };
    if (existing.kind === "ORDER" && existing.status !== "DRAFT") return { error: "Versendete Auftragsbestätigungen können nicht geändert werden. Bitte stornieren und neu erstellen." };
    await db.invoice.update({ where: { id }, data });
  } else {
    if (d.kind === "ORDER") return { error: "Auftragsbestätigungen entstehen aus einem angenommenen Angebot." };
    const year = data.issueDate.getUTCFullYear();
    const created = await db.$transaction(async (tx) => {
      const number = await allocateNumber(tx, ws.id, d.kind, year);
      return tx.invoice.create({ data: { ...data, workspaceId: ws.id, kind: d.kind, number } });
    });
    targetId = created.id;
  }
  revalidatePath(`/sa/${slug}/rechnungen`);
  redirect(`/sa/${slug}/rechnungen/${targetId}`);
}

const flowError = (e: unknown) => (e instanceof DocumentFlowError ? e.message : null);

/** Rechnung aus Angebot oder Auftragsbestätigung (Entwurf). */
export async function convertToInvoice(slug: string, sourceId: string) {
  const back = `/sa/${slug}/rechnungen/${sourceId}`;
  const { ws, user } = await guardOrRedirect(slug, { object: "invoices", action: "edit" }, back);
  let targetId: string;
  try {
    targetId = (await createInvoiceFrom(ws.id, sourceId, `user:${user.id}`)).id;
  } catch (e) {
    const m = flowError(e);
    if (!m) throw e;
    redirect(`${back}?fehler=${encodeURIComponent(m)}`);
  }
  revalidatePath(`/sa/${slug}/rechnungen`);
  redirect(`/sa/${slug}/rechnungen/${targetId}`);
}

/** Auftragsbestätigung aus Angebot erzeugen (Angebot wird angenommen). */
export async function createOrder(slug: string, quoteId: string, formData: FormData) {
  const back = `/sa/${slug}/rechnungen/${quoteId}`;
  const { ws, user } = await guardOrRedirect(slug, { object: "invoices", action: "edit" }, back);
  const ref = z.string().trim().max(100).catch("").parse(formData.get("customerOrderRef") ?? "");
  let orderId: string;
  try {
    orderId = (await createOrderFromQuote(ws.id, quoteId, `user:${user.id}`, { customerOrderRef: ref || null })).id;
  } catch (e) {
    const m = flowError(e);
    if (!m) throw e;
    redirect(`${back}?fehler=${encodeURIComponent(m)}`);
  }
  revalidatePath(`/sa/${slug}/rechnungen`);
  redirect(`/sa/${slug}/rechnungen/${orderId}`);
}

/** Angebot als angenommen markieren (z. B. Zusage per Telefon). */
export async function markAccepted(slug: string, quoteId: string, formData: FormData) {
  const back = `/sa/${slug}/rechnungen/${quoteId}`;
  const { ws, user } = await guardOrRedirect(slug, { object: "invoices", action: "edit" }, back);
  const ref = z.string().trim().max(100).catch("").parse(formData.get("customerOrderRef") ?? "");
  try {
    await acceptQuote(ws.id, quoteId, `user:${user.id}`, { customerOrderRef: ref || null });
  } catch (e) {
    const m = flowError(e);
    if (!m) throw e;
    redirect(`${back}?fehler=${encodeURIComponent(m)}`);
  }
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("Angebot als angenommen markiert.")}`);
}

export type SendState = { error?: string; ok?: string };

/**
 * Beleg per E-Mail mit PDF senden. Außenwirkung: braucht invoices.edit; ohne Freigaberecht oder bei Vier-Augen
 * entsteht eine Freigabe-Anfrage statt des Versands.
 */
export async function sendDocumentAction(slug: string, id: string, _prev: SendState, formData: FormData): Promise<SendState> {
  let ctx;
  try {
    ctx = await guard(slug, { object: "invoices", action: "edit" });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  const { ws, user, access } = ctx;
  const p = z
    .object({
      to: z.email("Bitte eine gültige Empfänger-Adresse angeben.").max(254),
      subject: z.string().trim().min(1, "Betreff fehlt.").max(300),
      body: z.string().trim().min(1, "Text fehlt.").max(8000),
      withAcceptLink: z.boolean(),
    })
    .safeParse({ to: String(formData.get("to") ?? "").trim(), subject: formData.get("subject"), body: formData.get("body"), withAcceptLink: formData.get("withAcceptLink") === "on" });
  if (!p.success) return { error: p.error.issues[0].message };
  const inv = await db.invoice.findFirst({ where: { id, workspaceId: ws.id }, select: { id: true, number: true, kind: true, status: true } });
  if (!inv) return { error: "Beleg nicht gefunden." };
  if (inv.status === "CANCELLED") return { error: "Stornierte Belege werden nicht versendet." };
  const actor = `user:${user.id}`;
  const needsApproval = !hasSpecial(access, "approve") || ws.fourEyes;
  try {
    if (needsApproval) {
      const { requestApproval } = await import("@/lib/approvals");
      await requestApproval({
        workspaceId: ws.id,
        kind: "document.send",
        title: `${inv.number} per E-Mail an ${p.data.to} senden`,
        summary: `Betreff: ${p.data.subject}`,
        payload: { invoiceId: inv.id, to: p.data.to, subject: p.data.subject, body: p.data.body, withAcceptLink: p.data.withAcceptLink },
        requestedBy: actor,
      });
      return { ok: "Freigabe angefragt – der Versand erfolgt nach Zustimmung im Freigabe-Eingang." };
    }
    const { sendDocument } = await import("@/lib/documents/send");
    const r = await sendDocument(ws.id, inv.id, actor, { to: p.data.to, subject: p.data.subject, body: p.data.body }, { withAcceptLink: p.data.withAcceptLink });
    revalidatePath(`/sa/${slug}/rechnungen/${id}`);
    return { ok: r.delivery === "captured" ? "Gesendet (Testmodus: in Mailpit abgefangen)." : "Gesendet." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Versand fehlgeschlagen." };
  }
}

const STATUSES = ["DRAFT", "SENT", "ACCEPTED", "PAID", "CANCELLED"] as const;

export async function setStatus(slug: string, id: string, formData: FormData) {
  const { ws, user } = await guardOrRedirect(slug, { object: "invoices", action: "edit" }, `/sa/${slug}/rechnungen/${id}`);
  const status = z.enum(STATUSES).parse(formData.get("status"));
  await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id, workspaceId: ws.id } });
    if (!inv || inv.status === status) return;
    const r = await tx.invoice.updateMany({ where: { id, workspaceId: ws.id, status: inv.status }, data: { status } });
    // Manuell als bezahlt markiert (z. B. Barzahlung): gleiches Ereignis wie bei Online-/Bankzahlung → Prozesse starten
    if (r.count && status === "PAID" && inv.kind === "INVOICE") await emitInvoicePaid(tx, inv, { via: "manual", actor: `user:${user.id}` });
  });
  revalidatePath(`/sa/${slug}/rechnungen/${id}`);
}

export async function deleteDraft(slug: string, id: string) {
  const { ws } = await guardOrRedirect(slug, { object: "invoices", action: "delete" }, `/sa/${slug}/rechnungen/${id}`);
  // Nur Entwürfe dürfen gelöscht werden; Rechnungsnummern bleiben sonst lückenlos nachvollziehbar
  await db.invoice.deleteMany({ where: { id, workspaceId: ws.id, status: "DRAFT", kind: "QUOTE" } });
  const inv = await db.invoice.findFirst({ where: { id, workspaceId: ws.id } });
  if ((inv?.kind === "INVOICE" || inv?.kind === "ORDER") && inv.status === "DRAFT") {
    await db.invoice.update({ where: { id }, data: { status: "CANCELLED", notes: [inv.notes, "Entwurf verworfen."].filter(Boolean).join("\n") } });
  }
  revalidatePath(`/sa/${slug}/rechnungen`);
  redirect(`/sa/${slug}/rechnungen`);
}
