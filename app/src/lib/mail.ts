import "server-only";
import { renderTemplate } from "./mail-template";
import nodemailer from "nodemailer";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { db } from "./db";
import { htmlToPlainText } from "./mail-template";

import { deliveryOf, parseAllowlist, relayTlsOptions, routeRecipients, type Delivery } from "./mail-routing";

// capture: alles geht an das lokale Mailpit, unabhängig von SMTP_HOST.
// live:    echter Versand über SMTP_HOST (nur bewusst einschalten).
// live + MAIL_LIVE_ALLOWLIST: nur Empfänger auf der Liste live, alle anderen an Mailpit (Testbetrieb).
function captureTransport() {
  return nodemailer.createTransport({ host: "127.0.0.1", port: 51025, secure: false });
}

function relayTransport() {
  const port = env.smtpPort();
  return nodemailer.createTransport({
    host: env.smtpHost(),
    port,
    ...relayTlsOptions(port, env.smtpSecure()),
    auth: env.smtpUser() ? { user: env.smtpUser()!, pass: env.smtpPass()! } : undefined,
  });
}

/** Aktive Freigabeliste für echten Versand (null = keine Liste). */
export function mailAllowlist() {
  return parseAllowlist(process.env.MAIL_LIVE_ALLOWLIST);
}

/** Status für das Versandprotokoll je Zustellweg. */
export function statusForDelivery(d: Delivery) {
  return d === "captured" ? "captured" : "sent";
}

export function unsubscribeToken(contactId: string): string {
  return createHmac("sha256", env.appSecret()).update(`unsub:${contactId}`).digest("base64url");
}

export function verifyUnsubscribeToken(contactId: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(contactId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(contactId: string): string {
  return `${env.appUrl()}/u/${contactId}/${unsubscribeToken(contactId)}`;
}

// ---------- Sperrliste ----------

/** Gesperrt gilt für JEDEN Versand (auch transaktional): harte Bounces, Spam-Beschwerden, manuelle Sperren. */
export async function suppressionFor(workspaceId: string, email: string) {
  return db.suppression.findUnique({ where: { workspaceId_email: { workspaceId, email: email.trim().toLowerCase() } } });
}

export class SuppressedError extends Error {
  constructor(public email: string, public reason: string) {
    super(`Adresse ${email} ist gesperrt (${reason})`);
  }
}

/** Eigene Message-ID (Brevo-ähnlich) – wird an Produkte zurückgegeben und dient der Zuordnung von Ereignissen. */
export function newMessageId(fromEmail: string): string {
  const domain = fromEmail.split("@").pop() || "pioneerdesk.local";
  return `<${Date.now().toString(36)}.${randomBytes(9).toString("hex")}@${domain}>`;
}

export type RawMail = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string; encoding: "base64" }[];
  messageId: string;
};

/**
 * Niedrigste Ebene: eine Mail versenden. Empfänger werden je nach Modus/Freigabeliste auf echtes Relay
 * und Mailpit aufgeteilt (nie still verworfen). Liefert Message-ID und tatsächlichen Zustellweg.
 */
export async function sendRawDetailed(m: RawMail): Promise<{ messageId: string; delivery: Delivery }> {
  const route = routeRecipients({ to: m.to, cc: m.cc, bcc: m.bcc }, env.mailMode(), mailAllowlist());
  const delivery = deliveryOf(route);
  const base = {
    from: m.from,
    replyTo: m.replyTo,
    subject: m.subject,
    text: m.text,
    html: m.html,
    headers: { ...(m.headers ?? {}), "X-PD-Delivery": delivery },
    attachments: m.attachments,
    messageId: m.messageId,
  };
  const parts: [ReturnType<typeof nodemailer.createTransport>, typeof route.live, "live" | "captured"][] = [];
  if (route.live.to.length + (route.live.cc?.length ?? 0) + (route.live.bcc?.length ?? 0) > 0) parts.push([relayTransport(), route.live, "live"]);
  if (route.captured.to.length + (route.captured.cc?.length ?? 0) + (route.captured.bcc?.length ?? 0) > 0) parts.push([captureTransport(), route.captured, "captured"]);
  let messageId = m.messageId;
  for (const [transport, r, routeName] of parts) {
    // Kein To (nur Cc/Bcc in diesem Teil): erstes Cc als To verwenden, damit Relays nicht ablehnen
    const to = r.to.length ? r.to : (r.cc?.length ? [r.cc[0]] : r.bcc!.slice(0, 1));
    const info = await transport.sendMail({
      ...base,
      headers: { ...base.headers, "X-PD-Route": routeName },
      to,
      cc: r.cc?.filter((x) => !to.includes(x)).length ? r.cc.filter((x) => !to.includes(x)) : undefined,
      bcc: r.bcc?.filter((x) => !to.includes(x)).length ? r.bcc.filter((x) => !to.includes(x)) : undefined,
    });
    messageId = info.messageId ?? messageId;
  }
  return { messageId, delivery };
}

/** Wie sendRawDetailed, liefert nur die Message-ID (bisherige Schnittstelle). */
export async function sendRaw(m: RawMail) {
  return (await sendRawDetailed(m)).messageId;
}

export function formatAddress(email: string, name?: string | null) {
  return name ? `"${name.replace(/["\r\n]/g, "")}" <${email}>` : email;
}

type SendInput = {
  workspaceId: string;
  to: string;
  subject: string;
  text: string;
  /** optional: HTML-Fassung; Text bleibt als Fallback erhalten */
  html?: string;
  contactId?: string;
  campaignId?: string;
  listUnsubscribe?: string;
  /** one_to_one (Standard) | campaign | system */
  kind?: "one_to_one" | "campaign" | "system";
};

export async function sendMail(input: SendInput) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: input.workspaceId } });
  if (!ws.mailFromEmail) throw new Error(`Für ${ws.name} ist keine Absenderadresse hinterlegt`);
  const from = formatAddress(ws.mailFromEmail, ws.mailFromName);
  const kind = input.kind ?? (input.campaignId ? "campaign" : "one_to_one");
  const text = input.text || (input.html ? htmlToPlainText(input.html) : "");

  // Sperrliste prüfen: protokollieren, nicht senden
  const blocked = await suppressionFor(input.workspaceId, input.to);
  if (blocked) {
    const msg = await db.emailMessage.create({
      data: {
        workspaceId: input.workspaceId, contactId: input.contactId, campaignId: input.campaignId, direction: "OUT",
        fromAddr: ws.mailFromEmail, toAddr: input.to, subject: input.subject, bodyText: text, htmlBody: input.html,
        status: "blocked", kind, error: `gesperrt: ${blocked.reason}`,
      },
    });
    await db.emailEvent.create({ data: { workspaceId: input.workspaceId, messageId: msg.id, event: "blocked", reason: blocked.reason } });
    throw new SuppressedError(input.to, blocked.reason);
  }

  const msg = await db.emailMessage.create({
    data: {
      workspaceId: input.workspaceId, contactId: input.contactId, campaignId: input.campaignId, direction: "OUT",
      fromAddr: ws.mailFromEmail, toAddr: input.to, subject: input.subject, bodyText: text, htmlBody: input.html,
      messageId: newMessageId(ws.mailFromEmail), status: "queued", kind,
    },
  });
  const headers: Record<string, string> = { "X-PD-Message-Id": msg.id, "X-Mailin-custom": `pd:${msg.id}` };
  if (input.listUnsubscribe) {
    headers["List-Unsubscribe"] = `<${input.listUnsubscribe}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  let messageId: string;
  let delivery: Delivery;
  try {
    ({ messageId, delivery } = await sendRawDetailed({ from, to: [input.to], subject: input.subject, text, html: input.html, headers, messageId: msg.messageId! }));
  } catch (err) {
    const error = String(err instanceof Error ? err.message : err).slice(0, 500);
    await db.emailMessage.update({ where: { id: msg.id }, data: { status: "failed", error } });
    await db.emailEvent.create({ data: { workspaceId: input.workspaceId, messageId: msg.id, event: "error", reason: error } });
    throw err;
  }
  await db.emailMessage.update({
    where: { id: msg.id },
    data: { messageId, status: statusForDelivery(delivery), sentAt: new Date() },
  });
  // Zustellweg (live/captured) im Ereignis festhalten
  await db.emailEvent.create({ data: { workspaceId: input.workspaceId, messageId: msg.id, event: "request", reason: delivery } });
  if (input.contactId) {
    await db.activity.create({
      data: {
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        type: "EMAIL_OUT",
        body: `E-Mail: ${input.subject}`,
        meta: { campaignId: input.campaignId ?? null, mode: env.mailMode(), delivery },
      },
    });
  }
  return messageId;
}

/** Empfänger einer Kampagne: nur mit Einwilligung, nicht abgemeldet, mit E-Mail. */
export async function campaignAudience(workspaceId: string, audience: unknown) {
  const a = audience as { tags?: string[]; listIds?: string[] } | null;
  const tags = a?.tags?.filter(Boolean) ?? [];
  const listIds = a?.listIds?.filter(Boolean) ?? [];
  // Tags und Listen: Kontakt gehört dazu, wenn er einen der Tags ODER eine der Listen hat
  const or = [
    ...(tags.length ? [{ tags: { hasSome: tags } }] : []),
    ...(listIds.length ? [{ listMemberships: { some: { listId: { in: listIds }, list: { workspaceId } } } }] : []),
  ];
  return db.contact.findMany({
    where: {
      workspaceId,
      email: { not: null },
      consentEmailAt: { not: null },
      unsubscribedAt: null,
      ...(or.length ? { OR: or } : {}),
    },
    select: { id: true, email: true, firstName: true, lastName: true, company: true, attributes: true },
  });
}

/** Versendet eine freigegebene Kampagne. Bricht ab, wenn sie nicht freigegeben ist. */
export async function sendCampaign(campaignId: string) {
  const claimed = await db.campaign.updateMany({
    where: { id: campaignId, status: "APPROVED", approvedAt: { not: null } },
    data: { status: "SENDING" },
  });
  if (claimed.count === 0) throw new Error("Kampagne ist nicht freigegeben oder wird bereits versendet");

  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const recipients = await campaignAudience(c.workspaceId, c.audience);
  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    const rec = await db.campaignRecipient.upsert({
      where: { campaignId_contactId: { campaignId, contactId: r.id } },
      create: { campaignId, contactId: r.id },
      update: {},
    });
    if (rec.status === "sent") continue;
    const unsub = unsubscribeUrl(r.id);
    // Anrede & Kontaktangaben nur über Platzhalter im Text (z. B. „Hallo {{ contact.FIRSTNAME | default: "zusammen" }},“) –
    // keine starre Anrede mehr, die sich mit der Anrede im Text doppelt
    const tctx = {
      contact: {
        ...((r.attributes as Record<string, unknown>) ?? {}),
        FIRSTNAME: r.firstName ?? "",
        LASTNAME: r.lastName ?? "",
        EMAIL: r.email ?? "",
        COMPANY: r.company ?? "",
      },
    };
    try {
      const messageId = await sendMail({
        workspaceId: c.workspaceId,
        to: r.email!,
        subject: renderTemplate(c.subject, tctx, { html: false }),
        text: `${renderTemplate(c.bodyMarkdown, tctx, { html: false })}\n\n--\nAbmelden: ${unsub}`,
        contactId: r.id,
        campaignId,
        listUnsubscribe: `${unsub}/one-click`,
      });
      await db.campaignRecipient.update({ where: { id: rec.id }, data: { status: "sent", sentAt: new Date(), messageId } });
      sent++;
    } catch (err) {
      const suppressed = err instanceof SuppressedError;
      await db.campaignRecipient.update({
        where: { id: rec.id },
        data: { status: suppressed ? "skipped" : "failed", error: String(err instanceof Error ? err.message : err).slice(0, 300) },
      });
      if (!suppressed) failed++;
    }
  }

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: failed > 0 && sent === 0 ? "FAILED" : "SENT", sentAt: new Date() },
  });
  return { total: recipients.length, sent, failed };
}
