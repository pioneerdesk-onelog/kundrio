import "server-only";
import { db } from "./db";
import { enqueue } from "./jobs";
import { checkTransactional, senderDomainAllowed } from "./mail-schema";
import { htmlToPlainText, renderTemplate, type TemplateContext } from "./mail-template";
import { formatAddress, newMessageId, sendRawDetailed, statusForDelivery, suppressionFor } from "./mail";
import { emitMailEvent } from "./webhook";

// Brevo-kompatibler Transaktionsversand: annehmen (synchron, prüft alles) → Job → Versand (asynchron).

export type AcceptResult = { status: number; body: Record<string, unknown> };

type Addr = { email: string; name?: string };
const norm = (a: Addr): Addr => ({ email: a.email.trim().toLowerCase(), name: a.name?.trim() || undefined });

/** Kontakt-Felder für {{ contact.X }} (Brevo-Stil: FIRSTNAME, LASTNAME, …, dazu eigene Attribute). */
async function contactContext(workspaceId: string, email: string) {
  const c = await db.contact.findUnique({ where: { workspaceId_email: { workspaceId, email } } });
  if (!c) return { contactId: undefined, contact: {} as Record<string, unknown> };
  const attrs = (c.attributes && typeof c.attributes === "object" && !Array.isArray(c.attributes) ? c.attributes : {}) as Record<string, unknown>;
  return {
    contactId: c.id,
    contact: { ...attrs, FIRSTNAME: c.firstName ?? "", LASTNAME: c.lastName ?? "", EMAIL: c.email ?? "", COMPANY: c.company ?? "", SMS: c.phone ?? "" },
  };
}

export async function acceptTransactional(auth: { workspaceId: string; keyId: string }, raw: unknown): Promise<AcceptResult> {
  const checked = checkTransactional(raw);
  if (!checked.ok) return { status: 400, body: { code: checked.code, message: checked.message } };
  const d = checked.data;
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId } });

  // Vorlage (nur eigene, aktive)
  let tpl = null;
  if (d.templateId) {
    tpl = await db.emailTemplate.findFirst({ where: { numericId: d.templateId, workspaceId: ws.id } });
    if (!tpl) return { status: 404, body: { code: "document_not_found", message: "Template ID does not exist" } };
    if (!tpl.isActive) return { status: 400, body: { code: "invalid_parameter", message: "Template is not active" } };
  }

  // Absender: Payload > Vorlage > Sub-Account
  const senderEmail = (d.sender?.email ?? tpl?.senderEmail ?? ws.mailFromEmail ?? "").toLowerCase();
  const senderName = d.sender?.name ?? tpl?.senderName ?? ws.mailFromName ?? undefined;
  if (!senderEmail) return { status: 400, body: { code: "missing_parameter", message: "sender is missing" } };
  if (!senderDomainAllowed(senderEmail, ws.domain, ws.allowedOrigins)) {
    return { status: 400, body: { code: "invalid_parameter", message: `Sender ${senderEmail} is not allowed for this account (Domain ${ws.domain ?? "–"})` } };
  }

  // Sperrliste: gesperrte Empfänger entfernen (Brevo antwortet trotzdem 201 und meldet "blocked")
  const to = d.to.map(norm);
  const cc = (d.cc ?? []).map(norm);
  const bcc = (d.bcc ?? []).map(norm);
  const blocked: { email: string; reason: string }[] = [];
  const keep = async (list: Addr[]) => {
    const out: Addr[] = [];
    for (const a of list) {
      const s = await suppressionFor(ws.id, a.email);
      if (s) blocked.push({ email: a.email, reason: s.reason });
      else out.push(a);
    }
    return out;
  };
  const toOk = await keep(to);
  const ccOk = await keep(cc);
  const bccOk = await keep(bcc);

  // Inhalte rendern (Platzhalter mit params + Kontaktdaten des ersten Empfängers)
  const first = to[0];
  const { contactId, contact } = await contactContext(ws.id, first.email);
  const ctx: TemplateContext = { params: d.params ?? {}, contact };
  const subjectSrc = d.subject ?? tpl?.subject ?? "";
  const htmlSrc = d.htmlContent ?? tpl?.html ?? undefined;
  const textSrc = d.textContent ?? tpl?.text ?? undefined;
  const subject = renderTemplate(subjectSrc, ctx, { html: false }).replace(/[\r\n]+/g, " ").slice(0, 998);
  const html = htmlSrc !== undefined ? renderTemplate(htmlSrc, ctx, { html: true }) : undefined;
  const text = textSrc !== undefined ? renderTemplate(textSrc, ctx, { html: false }) : html ? htmlToPlainText(html) : "";

  const messageId = newMessageId(senderEmail);
  const allBlocked = toOk.length === 0;
  const msg = await db.emailMessage.create({
    data: {
      workspaceId: ws.id,
      contactId: to.length === 1 ? contactId : undefined,
      direction: "OUT",
      kind: "transactional",
      fromAddr: senderEmail,
      toAddr: to.map((a) => a.email).join(", ").slice(0, 2000),
      subject,
      bodyText: text,
      htmlBody: html,
      messageId,
      templateId: tpl?.id,
      tags: d.tags ?? [],
      apiKeyId: auth.keyId,
      status: allBlocked ? "blocked" : "queued",
      error: blocked.length ? `gesperrt: ${blocked.map((b) => `${b.email} (${b.reason})`).join(", ")}`.slice(0, 500) : null,
      scheduledAt: checked.scheduledAt,
    },
  });
  await db.emailEvent.create({ data: { workspaceId: ws.id, messageId: msg.id, event: "request" } });
  for (const b of blocked) {
    await db.emailEvent.create({ data: { workspaceId: ws.id, messageId: msg.id, event: "blocked", reason: `${b.email}: ${b.reason}` } });
    await emitMailEvent(ws.id, "transactional", {
      event: "blocked", email: b.email, messageId, emailMessageId: msg.id, subject, tags: d.tags ?? [], templateId: tpl?.numericId, reason: b.reason,
    });
  }

  if (!allBlocked) {
    await emitMailEvent(ws.id, "transactional", {
      event: "request", email: toOk[0].email, messageId, emailMessageId: msg.id, subject, tags: d.tags ?? [], templateId: tpl?.numericId,
    });
    await enqueue(
      "mail.transactional",
      {
        emailMessageId: msg.id,
        from: formatAddress(senderEmail, senderName),
        to: toOk.map((a) => formatAddress(a.email, a.name)),
        cc: ccOk.map((a) => formatAddress(a.email, a.name)),
        bcc: bccOk.map((a) => formatAddress(a.email, a.name)),
        replyTo: d.replyTo ? formatAddress(d.replyTo.email, d.replyTo.name) : tpl?.replyTo ?? undefined,
        headers: checked.headers,
        attachments: checked.attachments.map((a) => ({ filename: a.filename, content: a.content })),
      },
      { runAt: checked.scheduledAt ?? undefined },
    );
  }

  // Brevo: 201 { messageId } – bei Zeitplanung zusätzlich ein messageIds-Array
  return { status: 201, body: checked.scheduledAt ? { messageId, messageIds: [messageId] } : { messageId } };
}

type JobPayload = {
  emailMessageId: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string }[];
};

/** Vom Worker aufgerufen. Idempotent: bereits versendete Nachrichten werden nicht erneut gesendet. */
export async function processTransactional(p: JobPayload) {
  const msg = await db.emailMessage.findUnique({ where: { id: p.emailMessageId } });
  if (!msg || msg.status !== "queued") return;

  // Späte Sperre (zwischen Annahme und Versand gesperrt) berücksichtigen
  const to: string[] = [];
  for (const addr of p.to) {
    const email = (addr.match(/<([^>]+)>/)?.[1] ?? addr).toLowerCase();
    if (!(await suppressionFor(msg.workspaceId, email))) to.push(addr);
  }
  if (to.length === 0) {
    await db.emailMessage.update({ where: { id: msg.id }, data: { status: "blocked", error: "alle Empfänger gesperrt" } });
    await db.emailEvent.create({ data: { workspaceId: msg.workspaceId, messageId: msg.id, event: "blocked", reason: "alle Empfänger gesperrt" } });
    return;
  }

  let sent: Awaited<ReturnType<typeof sendRawDetailed>>;
  try {
    sent = await sendRawDetailed({
      from: p.from,
      to,
      cc: p.cc,
      bcc: p.bcc,
      replyTo: p.replyTo,
      subject: msg.subject,
      text: msg.bodyText,
      html: msg.htmlBody ?? undefined,
      headers: { ...(p.headers ?? {}), "X-PD-Message-Id": msg.id, "X-Mailin-custom": `pd:${msg.id}` },
      attachments: p.attachments?.map((a) => ({ ...a, encoding: "base64" as const })),
      messageId: msg.messageId!,
    });
  } catch (err) {
    const error = String(err instanceof Error ? err.message : err).slice(0, 500);
    await db.emailMessage.update({ where: { id: msg.id }, data: { error } });
    await db.emailEvent.create({ data: { workspaceId: msg.workspaceId, messageId: msg.id, event: "error", reason: error } });
    await emitMailEvent(msg.workspaceId, "transactional", {
      event: "error", email: msg.toAddr.split(",")[0].trim(), messageId: msg.messageId, emailMessageId: msg.id, subject: msg.subject, tags: msg.tags, reason: error,
    });
    throw err; // Job-Wiederholung
  }
  await db.emailMessage.update({
    where: { id: msg.id },
    data: { status: statusForDelivery(sent.delivery), sentAt: new Date(), error: null },
  });
  await db.emailEvent.create({ data: { workspaceId: msg.workspaceId, messageId: msg.id, event: "delivery", reason: sent.delivery } });
}
