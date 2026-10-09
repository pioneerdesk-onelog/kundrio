import "server-only";
import type { Inbox, Prisma } from "@prisma/client";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { mailAllowlist, newMessageId, formatAddress } from "@/lib/mail";
import { deliveryOf, relayTlsOptions, routeRecipients } from "@/lib/mail-routing";
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from "../channel";
import { parseInboxConfig, type InboxConfig } from "../config";
import { parseRawEmail } from "./email-parse";

// E-Mail-Kanal: Abruf per IMAP (imapflow), Versand per SMTP mit den Zugangsdaten DIESER Inbox.
// Versand respektiert MAIL_MODE/MAIL_LIVE_ALLOWLIST wie src/lib/mail.ts: im capture-Modus und für
// nicht freigegebene Empfänger geht die Mail an Mailpit (nie still verworfen).
// Ausblick: Gmail API / Microsoft Graph Mail über die vorhandenen Kalender-OAuth-Verbindungen
// (bräuchte zusätzliche Scopes gmail.modify bzw. Mail.ReadWrite/Mail.Send) – bewusst noch nicht gebaut.

const FIRST_SYNC_DAYS = 7;
const MAX_PER_RUN = 100;
const MAILPIT = { host: "127.0.0.1", port: 51025 };

function imapClient(cfg: InboxConfig, creds: Record<string, string>) {
  if (!cfg.imapHost || !cfg.imapUser) throw new Error("IMAP-Server/Benutzer fehlt");
  if (!creds.imapPassword) throw new Error("IMAP-Passwort fehlt – Postfach neu verbinden");
  return new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort ?? 993,
    secure: cfg.imapSecure ?? true,
    auth: { user: cfg.imapUser, pass: creds.imapPassword },
    logger: false,
    socketTimeout: 60_000,
    greetingTimeout: 15_000,
  });
}

function smtpTransport(cfg: InboxConfig, creds: Record<string, string>) {
  if (!cfg.smtpHost || !cfg.smtpUser) throw new Error("SMTP-Server/Benutzer fehlt");
  const port = cfg.smtpPort ?? 587;
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port,
    ...relayTlsOptions(port, port === 465),
    auth: { user: cfg.smtpUser, pass: creds.smtpPassword ?? creds.imapPassword ?? "" },
  });
}

export type EmailBatch = { messages: InboundMessage[]; cursor: InboxConfig["cursor"] };

/**
 * Neue Nachrichten seit dem letzten Abruf (UID-Merker je Ordner). Erster Abruf: nur die letzten 7 Tage.
 * Der neue Merker wird NICHT gespeichert – das macht der Aufrufer erst nach erfolgreicher Übernahme.
 */
export async function fetchEmailBatch(inbox: Inbox, creds: Record<string, string>): Promise<EmailBatch> {
  const cfg = parseInboxConfig(inbox.config);
  const folder = cfg.folder ?? "INBOX";
  const client = imapClient(cfg, creds);
  const messages: InboundMessage[] = [];
  const cursor = { ...(cfg.cursor ?? {}) };
  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const mb = client.mailbox;
      const uidValidity = mb && typeof mb === "object" ? String(mb.uidValidity) : "0";
      const prev = cursor[folder];
      let range: string;
      if (prev && prev.uidValidity === uidValidity) {
        range = `${prev.lastUid + 1}:*`;
      } else {
        // Erstabruf oder Ordner neu aufgebaut: nur jüngste Nachrichten
        const since = new Date(Date.now() - FIRST_SYNC_DAYS * 864e5);
        const uids = (await client.search({ since }, { uid: true })) || [];
        range = uids.length ? `${Math.min(...uids)}:*` : "";
        if (!range) {
          cursor[folder] = { uidValidity, lastUid: Number((mb && typeof mb === "object" ? mb.uidNext : 1) ?? 1) - 1 };
        }
      }
      let lastUid = prev && prev.uidValidity === uidValidity ? prev.lastUid : 0;
      if (range) {
        for await (const m of client.fetch(range, { uid: true, source: true }, { uid: true })) {
          if (!m.source || (prev && prev.uidValidity === uidValidity && m.uid <= prev.lastUid)) continue;
          try {
            messages.push(await parseRawEmail(m.source, { fallbackId: `${inbox.id}-${uidValidity}-${m.uid}` }));
          } catch {
            // unlesbare Nachricht überspringen, aber Merker weiterführen
          }
          lastUid = Math.max(lastUid, m.uid);
          if (messages.length >= MAX_PER_RUN) break;
        }
        if (cfg.markSeen && lastUid > 0 && messages.length) {
          await client.messageFlagsAdd(`${(prev?.lastUid ?? 0) + 1}:${lastUid}`, ["\\Seen"], { uid: true }).catch(() => {});
        }
        cursor[folder] = { uidValidity, lastUid: Math.max(lastUid, prev?.uidValidity === uidValidity ? prev.lastUid : 0) };
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return { messages, cursor };
}

export async function saveCursor(inboxId: string, cursor: InboxConfig["cursor"]) {
  const inbox = await db.inbox.findUnique({ where: { id: inboxId }, select: { config: true } });
  const cfg = (inbox?.config && typeof inbox.config === "object" ? inbox.config : {}) as Record<string, unknown>;
  await db.inbox.update({ where: { id: inboxId }, data: { config: { ...cfg, cursor } as Prisma.InputJsonValue } });
}

async function sendEmail(inbox: Inbox, creds: Record<string, string>, msg: OutboundMessage): Promise<SendResult> {
  const cfg = parseInboxConfig(inbox.config);
  const messageId = newMessageId(inbox.address);
  const route = routeRecipients({ to: msg.to, cc: msg.cc }, env.mailMode(), mailAllowlist());
  const delivery = deliveryOf(route);
  const base = {
    from: formatAddress(inbox.address, cfg.fromName || null),
    subject: msg.subject ?? "",
    text: msg.text,
    html: msg.html,
    inReplyTo: msg.inReplyTo,
    references: msg.references?.length ? msg.references.join(" ") : undefined,
    messageId,
    attachments: msg.attachments?.map((a) => ({ filename: a.name, content: a.content, contentType: a.mime })),
    headers: { "X-PD-Delivery": delivery },
  };
  const liveCount = route.live.to.length + (route.live.cc?.length ?? 0);
  const capCount = route.captured.to.length + (route.captured.cc?.length ?? 0);
  if (liveCount > 0) {
    const to = route.live.to.length ? route.live.to : [route.live.cc![0]];
    await smtpTransport(cfg, creds).sendMail({ ...base, to, cc: route.live.cc?.filter((x) => !to.includes(x)), headers: { ...base.headers, "X-PD-Route": "live" } });
  }
  if (capCount > 0) {
    const to = route.captured.to.length ? route.captured.to : [route.captured.cc![0]];
    await nodemailer
      .createTransport({ ...MAILPIT, secure: false })
      .sendMail({ ...base, to, cc: route.captured.cc?.filter((x) => !to.includes(x)), headers: { ...base.headers, "X-PD-Route": "captured" } });
  }
  // Nur an Mailpit umgeleitet (capture/Freigabeliste) → als Testmodus kennzeichnen
  return { externalId: messageId, status: liveCount === 0 && capCount > 0 ? "captured" : "sent" };
}

export const emailImapAdapter: ChannelAdapter = {
  kind: "email",
  provider: "imap",
  label: "E-Mail (IMAP/SMTP)",
  capabilities: { subject: true, attachments: true, html: true, templates: false },
  async fetchNew(inbox, creds) {
    const batch = await fetchEmailBatch(inbox, creds);
    await saveCursor(inbox.id, batch.cursor);
    return batch.messages;
  },
  send: sendEmail,
  async test(inbox, creds) {
    const cfg = parseInboxConfig(inbox.config);
    const client = imapClient(cfg, creds);
    try {
      await client.connect();
      const st = await client.status(cfg.folder ?? "INBOX", { messages: true, unseen: true });
      const status = st || { messages: 0, unseen: 0 };
      await client.logout().catch(() => {});
      if (env.mailMode() === "capture") {
        return { ok: true, detail: `IMAP ok (${status.messages ?? 0} Nachrichten, ${status.unseen ?? 0} ungelesen). SMTP nicht geprüft: Versand läuft im capture-Modus über Mailpit.` };
      }
      await smtpTransport(cfg, creds).verify();
      return { ok: true, detail: `IMAP und SMTP ok (${status.messages ?? 0} Nachrichten, ${status.unseen ?? 0} ungelesen).` };
    } catch (e) {
      client.close();
      return { ok: false, detail: e instanceof Error ? e.message.slice(0, 300) : "Verbindung fehlgeschlagen" };
    }
  },
};
