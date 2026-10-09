import "server-only";
import type { Invoice, Workspace, Contact } from "@prisma/client";
import { db } from "../db";
import { emitEvent } from "../events";
import { audit } from "../audit";
import { formatAddress, newMessageId, sendRawDetailed, statusForDelivery, suppressionFor, SuppressedError } from "../mail";
import { KIND_LABEL, isDocKind, type DocKind } from "../invoice";
import { acceptUrl } from "./accept-token";
import { renderDocumentPdf } from "./pdf";
import { paymentLinkFor } from "../payments/placeholders";
import { buildDocContext, renderDocText, resolveTexts, type DocContext } from "./texts";

// Versand eines Belegs per E-Mail mit PDF-Anhang. Außenwirkung → Aufrufer prüft Rechte/Freigabe.

type Loaded = Invoice & { contact: Contact | null };

async function load(workspaceId: string, invoiceId: string) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, workspaceId }, include: { contact: true } });
  if (!inv) throw new Error("Beleg nicht gefunden.");
  if (!isDocKind(inv.kind)) throw new Error("Unbekannte Belegart.");
  return { ws, inv: inv as Loaded, kind: inv.kind as DocKind };
}

async function senderName(actor: string): Promise<string | null> {
  const m = /user:([a-z0-9]+)/i.exec(actor);
  if (!m) return null;
  return (await db.user.findUnique({ where: { id: m[1] }, select: { name: true } }))?.name ?? null;
}

/** Bezahllink für Belegtexte – leer ohne verbundenen Anbieter oder wenn nichts offen ist. */
export async function paymentUrlFor(inv: Pick<Invoice, "id" | "workspaceId" | "kind">): Promise<string | null> {
  return inv.kind === "INVOICE" ? (await paymentLinkFor(inv.workspaceId, inv.id)) || null : null;
}

export function contextFor(ws: Workspace, inv: Loaded, userName: string | null, opts: { withAcceptLink?: boolean; paymentUrl?: string | null } = {}): DocContext {
  return buildDocContext(
    inv,
    inv.contact ? { firstName: inv.contact.firstName, lastName: inv.contact.lastName, company: inv.contact.company } : null,
    { companyName: ws.legalName ?? ws.name, userName, email: ws.legalEmail ?? ws.mailFromEmail, phone: ws.legalPhone },
    { acceptUrl: opts.withAcceptLink && inv.kind === "QUOTE" && inv.status !== "ACCEPTED" && inv.status !== "CANCELLED" ? acceptUrl(inv.id, inv.dueDate) : null, paymentUrl: opts.paymentUrl ?? null },
  );
}

/** Dokumenttexte (Einleitung/Schluss/Zahlungsbedingungen) eines Belegs – individueller Text vor Standardtext. */
export function documentTexts(ws: Workspace, inv: Pick<Invoice, "kind" | "introText" | "outroText">, ctx: DocContext) {
  const kind = isDocKind(inv.kind) ? inv.kind : "INVOICE";
  const t = resolveTexts(ws.documentTexts)[kind];
  return {
    intro: renderDocText(inv.introText?.trim() ? inv.introText : t.intro, ctx),
    outro: renderDocText(inv.outroText?.trim() ? inv.outroText : t.outro, ctx),
    paymentTerms: kind === "QUOTE" ? "" : renderDocText(t.paymentTerms, ctx),
  };
}

export async function documentPdf(workspaceId: string, invoiceId: string, actor = "system") {
  const { ws, inv } = await load(workspaceId, invoiceId);
  const ctx = contextFor(ws, inv, await senderName(actor), { paymentUrl: await paymentUrlFor(inv) });
  const bytes = await renderDocumentPdf(
    inv,
    { name: ws.legalName ?? ws.name, address: ws.legalAddress, phone: ws.legalPhone, email: ws.legalEmail ?? ws.mailFromEmail, domain: ws.domain, vatId: ws.vatId, iban: ws.iban, bic: ws.bic, brandPrimary: ws.brandPrimary },
    documentTexts(ws, inv, ctx),
  );
  return { bytes, filename: `${KIND_LABEL[inv.kind as DocKind]}-${inv.number}.pdf`.replace(/\s+/g, "-") };
}

export type MailDraft = { to: string; subject: string; body: string };

/** Vorschau: Empfänger, Betreff und Text aus der Vorlage (personalisiert). */
export async function prepareDocumentMail(workspaceId: string, invoiceId: string, actor: string, opts: { withAcceptLink?: boolean } = {}): Promise<MailDraft & { kind: DocKind; number: string }> {
  const { ws, inv, kind } = await load(workspaceId, invoiceId);
  const ctx = contextFor(ws, inv, await senderName(actor), { withAcceptLink: opts.withAcceptLink ?? true, paymentUrl: await paymentUrlFor(inv) });
  const t = resolveTexts(ws.documentTexts)[kind];
  return {
    to: inv.buyerEmail ?? inv.contact?.email ?? "",
    subject: renderDocText(t.emailSubject, ctx).replace(/\s+/g, " ").trim(),
    body: renderDocText(t.emailBody, ctx).replace(/\n{3,}/g, "\n\n").trim(),
    kind,
    number: inv.number,
  };
}

/**
 * Beleg per E-Mail mit PDF senden. `draft` überschreibt Empfänger/Betreff/Text (aus der Vorschau).
 * Setzt Status DRAFT → SENT, protokolliert Mail und Aktivität, Ereignis invoice.sent.
 */
export async function sendDocument(workspaceId: string, invoiceId: string, actor: string, draft?: Partial<MailDraft>, opts: { withAcceptLink?: boolean } = {}) {
  const base = await prepareDocumentMail(workspaceId, invoiceId, actor, opts);
  const to = (draft?.to ?? base.to).trim().toLowerCase();
  const subject = (draft?.subject ?? base.subject).trim().slice(0, 300);
  const body = (draft?.body ?? base.body).trim().slice(0, 8000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Bitte eine gültige Empfänger-Adresse angeben.");
  if (!subject) throw new Error("Betreff fehlt.");
  const { ws, inv } = await load(workspaceId, invoiceId);
  if (inv.status === "CANCELLED") throw new Error("Stornierte Belege werden nicht versendet.");
  if (!ws.mailFromEmail) throw new Error(`Für ${ws.name} ist keine Absenderadresse hinterlegt (Einstellungen).`);

  const blocked = await suppressionFor(workspaceId, to);
  if (blocked && blocked.reason !== "unsubscribed") {
    // Abmeldung betrifft nur Werbung; Belege sind Vertragskommunikation. Bounces/Beschwerden sperren aber.
    throw new SuppressedError(to, blocked.reason);
  }

  const pdf = await documentPdf(workspaceId, invoiceId, actor);
  const msg = await db.emailMessage.create({
    data: {
      workspaceId, contactId: inv.contactId, direction: "OUT", fromAddr: ws.mailFromEmail, toAddr: to, subject, bodyText: body,
      messageId: newMessageId(ws.mailFromEmail), status: "queued", kind: "one_to_one", tags: ["dokument", inv.kind.toLowerCase()],
    },
  });
  let messageId: string;
  let delivery: Awaited<ReturnType<typeof sendRawDetailed>>["delivery"];
  try {
    ({ messageId, delivery } = await sendRawDetailed({
      from: formatAddress(ws.mailFromEmail, ws.mailFromName ?? ws.legalName ?? ws.name),
      to: [to],
      subject,
      text: body,
      headers: { "X-PD-Message-Id": msg.id, "X-Mailin-custom": `pd:${msg.id}` },
      attachments: [{ filename: pdf.filename, content: Buffer.from(pdf.bytes).toString("base64"), encoding: "base64" }],
      messageId: msg.messageId!,
    }));
  } catch (err) {
    const error = String(err instanceof Error ? err.message : err).slice(0, 500);
    await db.emailMessage.update({ where: { id: msg.id }, data: { status: "failed", error } });
    await db.emailEvent.create({ data: { workspaceId, messageId: msg.id, event: "error", reason: error } });
    throw err;
  }
  await db.$transaction(async (tx) => {
    await tx.emailMessage.update({ where: { id: msg.id }, data: { messageId, status: statusForDelivery(delivery), sentAt: new Date() } });
    await tx.emailEvent.create({ data: { workspaceId, messageId: msg.id, event: "request", reason: delivery } });
    if (inv.status === "DRAFT") await tx.invoice.update({ where: { id: inv.id }, data: { status: "SENT" } });
    if (inv.contactId) {
      await tx.activity.create({
        data: { workspaceId, contactId: inv.contactId, type: "EMAIL_OUT", body: `${KIND_LABEL[inv.kind as DocKind]} ${inv.number} per E-Mail gesendet`, meta: { invoiceId: inv.id, emailId: msg.id, delivery } },
      });
    }
    await emitEvent({ workspaceId, type: "invoice.sent", objectType: "invoice", objectId: inv.id, data: { contactId: inv.contactId, kind: inv.kind, number: inv.number } }, tx);
  });
  await audit({ workspaceId, actor, action: "document.sent", target: inv.id, detail: { kind: inv.kind, emailId: msg.id } });
  return { emailId: msg.id, messageId, delivery };
}
