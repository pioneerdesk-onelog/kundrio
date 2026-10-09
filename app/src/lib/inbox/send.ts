import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import "./register";
import { getChannelAdapter, type OutboundMessage } from "./channel";
import { openCredentials } from "./credentials";
import { parseInboxConfig } from "./config";
import { bareEmail } from "./thread";

// Ausgehende Antworten und interne Notizen in einem Gespräch.

export type ReplyInput = { text: string; html?: string; cc?: string[]; fileIds?: string[]; subject?: string };

function quoteSubject(subject: string | null | undefined) {
  const s = (subject ?? "").trim();
  if (!s) return "";
  return /^(re|aw)\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** Freitext-Fenster (z. B. WhatsApp 24 h) eingehalten? */
export function withinFreeformWindow(lastInboundAt: Date | null, hours: number | undefined) {
  if (!hours) return true;
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() <= hours * 3600_000;
}

export async function replyToConversation(workspaceId: string, conversationId: string, userId: string, input: ReplyInput) {
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: {
      inbox: true,
      contact: { select: { id: true, email: true, phone: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!conv) throw new Error("Gespräch nicht gefunden");
  if (!conv.inbox.active) throw new Error("Dieser Posteingang ist deaktiviert.");
  const adapter = getChannelAdapter(conv.inbox.provider);
  if (!adapter) throw new Error(`Kein Kanal-Adapter für „${conv.inbox.provider}“ eingerichtet.`);
  const text = input.text.trim();
  if (!text) throw new Error("Bitte einen Text eingeben.");

  const lastIn = conv.messages.find((m) => m.direction === "in");
  if (!withinFreeformWindow(lastIn?.createdAt ?? null, adapter.capabilities.freeformWindowHours)) {
    throw new Error(`Freitext ist nur innerhalb von ${adapter.capabilities.freeformWindowHours} Stunden nach der letzten Kundennachricht erlaubt – bitte eine freigegebene Vorlage verwenden.`);
  }

  // Empfänger: Absender der letzten eingehenden Nachricht, sonst Kontakt
  const to =
    conv.inbox.kind === "email"
      ? [bareEmail(lastIn?.fromAddr ?? conv.contact?.email ?? "")].filter((x) => x.includes("@"))
      : [lastIn?.fromAddr ?? conv.contact?.phone ?? ""].filter(Boolean);
  if (to.length === 0) throw new Error("Kein Empfänger bekannt.");

  // Sperrliste (E-Mail): harte Bounces/Spam-Beschwerden nicht anschreiben
  if (conv.inbox.kind === "email") {
    const blocked = await db.suppression.findFirst({ where: { workspaceId, email: to[0], reason: { in: ["hard_bounce", "spam", "invalid", "manual"] } } });
    if (blocked) throw new Error(`Adresse ${to[0]} ist gesperrt (${blocked.reason}).`);
  }

  const cfg = parseInboxConfig(conv.inbox.config);
  const signature = cfg.signature?.trim();
  const fullText = signature ? `${text}\n\n-- \n${signature}` : text;

  // Thread-Header aus der letzten Nachricht mit Message-ID
  const lastWithId = conv.messages.find((m) => m.externalId);
  const references = [...(lastWithId?.references ?? []), ...(lastWithId?.externalId ? [lastWithId.externalId] : [])].slice(-20);

  const attachments: NonNullable<OutboundMessage["attachments"]> = [];
  const attMeta: { fileId: string; name: string; mime: string; size: number }[] = [];
  for (const id of input.fileIds ?? []) {
    const f = await readStoredFile(workspaceId, id);
    if (!f) continue;
    attachments.push({ name: f.file.name, mime: f.file.mime, content: Buffer.from(f.data) });
    attMeta.push({ fileId: f.file.id, name: f.file.name, mime: f.file.mime, size: f.file.size });
  }
  if (attachments.length && !adapter.capabilities.attachments) throw new Error("Dieser Kanal unterstützt keine Anhänge.");

  const msg: OutboundMessage = {
    to,
    cc: conv.inbox.kind === "email" ? (input.cc ?? []).map(bareEmail).filter((x) => x.includes("@")) : undefined,
    subject: adapter.capabilities.subject ? input.subject?.trim() || quoteSubject(conv.subject) : undefined,
    text: fullText,
    html: adapter.capabilities.html ? input.html : undefined,
    inReplyTo: lastWithId?.externalId ?? undefined,
    references,
    attachments,
  };

  // Erst protokollieren (queued), dann senden – so geht bei einem Absturz nichts verloren
  const record = await db.message.create({
    data: {
      workspaceId,
      conversationId: conv.id,
      direction: "out",
      channel: conv.inbox.kind,
      fromAddr: conv.inbox.address,
      toAddrs: to,
      ccAddrs: msg.cc ?? [],
      subject: msg.subject ?? null,
      bodyText: fullText,
      bodyHtml: msg.html ?? null,
      status: "queued",
      sentById: userId,
      attachments: attMeta as unknown as Prisma.InputJsonValue,
    },
  });
  try {
    const result = await adapter.send(conv.inbox, openCredentials(conv.inbox), msg);
    await db.$transaction([
      db.message.update({ where: { id: record.id }, data: { status: result.status, externalId: result.externalId, inReplyTo: msg.inReplyTo ?? null, references } }),
      db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), unread: 0, status: conv.status === "closed" ? "closed" : "pending" } }),
      ...(conv.contactId
        ? [db.activity.create({ data: { workspaceId, contactId: conv.contactId, type: conv.inbox.kind === "email" ? "EMAIL_OUT" : "SYSTEM", body: `Antwort gesendet${msg.subject ? `: ${msg.subject.slice(0, 200)}` : ""}`, meta: { conversationId: conv.id, messageId: record.id } } })]
        : []),
    ]);
    await audit({ workspaceId, actor: `user:${userId}`, action: "inbox.reply", target: conv.id, detail: { channel: conv.inbox.kind } });
    return { messageId: record.id };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await db.message.update({ where: { id: record.id }, data: { status: "failed", error } });
    throw new Error(`Senden fehlgeschlagen: ${error}`);
  }
}

export async function addNote(workspaceId: string, conversationId: string, userId: string, text: string) {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, include: { inbox: { select: { kind: true } } } });
  if (!conv) throw new Error("Gespräch nicht gefunden");
  const body = text.trim();
  if (!body) throw new Error("Bitte eine Notiz eingeben.");
  return db.message.create({
    data: { workspaceId, conversationId, direction: "note", channel: conv.inbox.kind, bodyText: body.slice(0, 20_000), status: "sent", sentById: userId },
  });
}
