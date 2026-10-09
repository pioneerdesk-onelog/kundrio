import "server-only";
import type { Inbox, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emitEvent } from "@/lib/events";
import { storeFile } from "@/lib/storage";
import { log } from "@/lib/log";
import type { InboundMessage } from "./channel";
import { pickAssignee } from "./assign";
import { bareEmail, normalizePhone, normalizeSubject, relatedMessageIds, splitName } from "./thread";

// Eingehende Nachrichten (aller Kanäle) übernehmen: entdoppeln, Gespräch finden oder anlegen,
// Kontakt zuordnen (oder anlegen), Anhänge speichern, Zuweisung, Ereignis + Aktivität.
// Jede Nachricht in einer eigenen Transaktion – ein Fehler betrifft nur diese eine Nachricht.

export type IngestResult = { created: number; duplicates: number; autoReplies: number; spam: number; failed: number; conversations: string[] };

const SUBJECT_FALLBACK_DAYS = 30;
const MAX_TEXT = 200_000;

type StoredAttachment = { fileId?: string; name: string; mime: string; size: number; skipped?: string };

async function storeAttachments(workspaceId: string, msg: InboundMessage): Promise<StoredAttachment[]> {
  const out: StoredAttachment[] = [];
  for (const a of msg.attachments ?? []) {
    try {
      const { file } = await storeFile({ workspaceId, kind: "document", name: a.name || "anhang", data: new Uint8Array(a.content) });
      out.push({ fileId: file.id, name: file.name, mime: file.mime, size: file.size });
    } catch (e) {
      // nicht erlaubter Typ / zu groß: Nachricht trotzdem übernehmen, Anhang nur vermerken
      out.push({ name: a.name, mime: a.mime, size: a.content.length, skipped: e instanceof Error ? e.message : "nicht gespeichert" });
    }
  }
  return out;
}

/** Kontakt per Adresse (E-Mail) bzw. Rufnummer (WhatsApp/SMS) im Sub-Account suchen. */
async function findContact(tx: Prisma.TransactionClient, inbox: Inbox, from: string) {
  if (inbox.kind === "email") {
    const email = bareEmail(from);
    if (!email.includes("@")) return null;
    return tx.contact.findFirst({ where: { workspaceId: inbox.workspaceId, email: { equals: email, mode: "insensitive" } }, select: { id: true, ownerId: true } });
  }
  const phone = normalizePhone(from);
  if (!phone) return null;
  const tail = phone.replace(/\D/g, "").slice(-9);
  const rows = await tx.$queryRaw<{ id: string; ownerId: string | null }[]>`
    SELECT "id", "ownerId" FROM "Contact"
    WHERE "workspaceId" = ${inbox.workspaceId} AND "phone" IS NOT NULL
      AND right(regexp_replace("phone", '[^0-9]', '', 'g'), 9) = ${tail}
    ORDER BY "createdAt" ASC LIMIT 1`;
  return rows[0] ?? null;
}

async function createContact(tx: Prisma.TransactionClient, inbox: Inbox, msg: InboundMessage) {
  const names = splitName(msg.fromName);
  const isEmail = inbox.kind === "email";
  const email = isEmail ? bareEmail(msg.from) : null;
  const phone = isEmail ? null : normalizePhone(msg.from);
  if (isEmail && !email?.includes("@")) return null;
  if (!isEmail && !phone) return null;
  const c = await tx.contact.create({
    data: {
      workspaceId: inbox.workspaceId,
      email: email || null,
      phone,
      firstName: names.firstName?.slice(0, 100) ?? null,
      lastName: names.lastName?.slice(0, 100) ?? null,
      source: "Posteingang",
    },
    select: { id: true, ownerId: true },
  });
  // Echter Neukontakt (kein Import) → Prozesse dürfen reagieren
  await emitEvent({ workspaceId: inbox.workspaceId, type: "contact.created", objectType: "contact", objectId: c.id, data: { source: "inbox", inboxId: inbox.id, channel: inbox.kind } }, tx);
  return c;
}

async function findConversation(tx: Prisma.TransactionClient, inbox: Inbox, msg: InboundMessage, contactId: string | null) {
  const byKey = await tx.conversation.findUnique({ where: { inboxId_threadKey: { inboxId: inbox.id, threadKey: msg.threadKey } } });
  if (byKey) return byKey;
  // Antwort auf eine bekannte Nachricht (In-Reply-To / References)?
  const related = relatedMessageIds(msg);
  if (related.length) {
    const hit = await tx.message.findFirst({ where: { externalId: { in: related }, conversation: { inboxId: inbox.id } }, select: { conversation: true } });
    if (hit) return hit.conversation;
  }
  // Rückfall (nur E-Mail): gleicher Kontakt + gleicher normalisierter Betreff in den letzten 30 Tagen
  if (inbox.kind === "email" && contactId && msg.subject) {
    const norm = normalizeSubject(msg.subject);
    if (norm) {
      const recent = await tx.conversation.findMany({
        where: { inboxId: inbox.id, contactId, lastMessageAt: { gte: new Date(Date.now() - SUBJECT_FALLBACK_DAYS * 864e5) } },
        orderBy: { lastMessageAt: "desc" },
        take: 20,
      });
      const same = recent.find((c) => normalizeSubject(c.subject) === norm);
      if (same) return same;
    }
  }
  return null;
}

export async function ingestInbound(inboxId: string, msgs: InboundMessage[]): Promise<IngestResult> {
  const res: IngestResult = { created: 0, duplicates: 0, autoReplies: 0, spam: 0, failed: 0, conversations: [] };
  const inbox = await db.inbox.findUnique({ where: { id: inboxId } });
  if (!inbox) throw new Error("Posteingang nicht gefunden");

  for (const msg of msgs) {
    try {
      // Entdoppeln vor teuren Schritten (Anhänge)
      const dup = await db.message.findFirst({ where: { externalId: msg.externalId, conversation: { inboxId } }, select: { id: true } });
      if (dup) {
        res.duplicates++;
        continue;
      }
      const autoReply = Boolean(msg.flags?.autoReply);
      const spam = Boolean(msg.flags?.spam);
      const attachments = spam ? [] : await storeAttachments(inbox.workspaceId, msg);

      const conversationId = await db.$transaction(async (tx) => {
        // Spam: kein Kontakt anlegen, Gespräch nur als erledigt + Tag „spam“
        let contact = spam ? null : await findContact(tx, inbox, msg.from);
        if (!contact && !spam && !autoReply) contact = await createContact(tx, inbox, msg);
        let conv = await findConversation(tx, inbox, msg, contact?.id ?? null);
        const now = msg.receivedAt ?? new Date();
        const isNew = !conv;

        if (!conv) {
          const assigneeId = spam || autoReply ? null : await pickAssignee(inbox, tx);
          conv = await tx.conversation.create({
            data: {
              workspaceId: inbox.workspaceId,
              inboxId: inbox.id,
              contactId: contact?.id ?? null,
              subject: msg.subject?.slice(0, 500) ?? null,
              status: spam ? "closed" : "open",
              tags: spam ? ["spam"] : autoReply ? ["automatische-antwort"] : [],
              assigneeId,
              threadKey: msg.threadKey.slice(0, 500),
              lastMessageAt: now,
              unread: 0,
            },
          });
        }

        await tx.message.create({
          data: {
            workspaceId: inbox.workspaceId,
            conversationId: conv.id,
            direction: "in",
            channel: inbox.kind,
            fromAddr: msg.from.slice(0, 320),
            toAddrs: msg.to.slice(0, 50),
            ccAddrs: (msg.cc ?? []).slice(0, 50),
            subject: msg.subject?.slice(0, 500) ?? null,
            bodyText: (msg.text || "").slice(0, MAX_TEXT),
            // Roh-HTML wird nur bereinigt angezeigt (siehe sanitize.ts); Größe begrenzen
            bodyHtml: msg.html ? msg.html.slice(0, 1_000_000) : null,
            externalId: msg.externalId,
            inReplyTo: msg.inReplyTo ?? null,
            references: (msg.references ?? []).slice(0, 100),
            status: "received",
            attachments: attachments as unknown as Prisma.InputJsonValue,
            createdAt: now,
          },
        });

        // Gesprächsstatus: neue echte Nachricht öffnet wieder; Auto-Antworten/Spam nicht
        const reopen = !autoReply && !spam && conv.status !== "open";
        await tx.conversation.update({
          where: { id: conv.id },
          data: {
            lastMessageAt: now > conv.lastMessageAt ? now : conv.lastMessageAt,
            unread: autoReply || spam ? conv.unread : { increment: 1 },
            ...(reopen ? { status: "open", snoozedUntil: null } : {}),
            ...(conv.contactId ? {} : contact ? { contactId: contact.id } : {}),
          },
        });

        const contactId = conv.contactId ?? contact?.id ?? null;
        if (contactId && !spam) {
          await tx.activity.create({
            data: {
              workspaceId: inbox.workspaceId,
              contactId,
              type: inbox.kind === "email" ? "EMAIL_IN" : "SYSTEM",
              body: `${inbox.kind === "email" ? "E-Mail" : inbox.kind === "whatsapp" ? "WhatsApp" : inbox.kind === "sms" ? "SMS" : "Nachricht"} eingegangen${msg.subject ? `: ${msg.subject.slice(0, 200)}` : ""}${autoReply ? " (automatische Antwort)" : ""}`,
              meta: { conversationId: conv.id, inboxId: inbox.id },
            },
          });
          if (!autoReply) {
            await emitEvent(
              {
                workspaceId: inbox.workspaceId,
                type: "conversation.message_received",
                objectType: "contact",
                objectId: contactId,
                data: { conversationId: conv.id, inboxId: inbox.id, channel: inbox.kind, newConversation: isNew },
              },
              tx,
            );
          }
        }
        return conv.id;
      });

      res.created++;
      if (autoReply) res.autoReplies++;
      if (spam) res.spam++;
      if (!res.conversations.includes(conversationId)) res.conversations.push(conversationId);
    } catch (e) {
      // Eindeutigkeit (gleichzeitiger Abruf derselben Nachricht) zählt als Dublette
      if ((e as { code?: string }).code === "P2002") {
        res.duplicates++;
        continue;
      }
      res.failed++;
      log.error("inbox.ingest_failed", { inboxId, externalId: msg.externalId.slice(0, 200), error: e instanceof Error ? e.message : String(e) });
    }
  }
  return res;
}
