import "server-only";
import type { Inbox } from "@prisma/client";
import { db } from "../db";
import { log, errMessage } from "../log";
import type { DeliveryUpdate, InboundMessage } from "../inbox/channel";
import { getChannelAdapter } from "../inbox/channel";
import { openCredentials } from "../inbox/credentials";
import { ingestInbound } from "../inbox/ingest";
import "./register";
import { setOptOut } from "./consent";
import type { ParsedWebhook } from "./parse";
import { isStartMessage, isStopMessage, type ChannelKind } from "./rules";
import { downloadWhatsAppMedia, toInbound } from "./whatsapp-cloud";

// Verarbeitung eingehender Webhook-Daten (im Worker): Medien laden, in den Posteingang übernehmen,
// Zustellstatus aktualisieren, STOP/START (Abmeldung) behandeln. Idempotent (Entdoppeln über externalId).

const STATUS_RANK: Record<string, number> = { queued: 0, captured: 0, sent: 1, delivered: 2, read: 3 };

export async function applyDeliveryUpdates(workspaceId: string, updates: DeliveryUpdate[]) {
  let changed = 0;
  for (const u of updates) {
    const msgs = await db.message.findMany({ where: { workspaceId, externalId: u.externalId, direction: "out" }, select: { id: true, status: true } });
    for (const m of msgs) {
      // Status nie zurückstufen (Webhooks kommen ungeordnet); „failed“ gilt immer
      if (u.status !== "failed" && (STATUS_RANK[u.status] ?? 0) <= (STATUS_RANK[m.status] ?? -1)) continue;
      await db.message.update({ where: { id: m.id }, data: { status: u.status, error: u.status === "failed" ? (u.error ?? "Zustellung fehlgeschlagen").slice(0, 300) : null } });
      changed++;
    }
  }
  return changed;
}

const OPT_OUT_TEXT = "Sie erhalten von uns keine weiteren Nachrichten über diesen Kanal. Mit START können Sie sich wieder anmelden.";
const OPT_IN_TEXT = "Sie sind wieder angemeldet. Mit STOP können Sie sich jederzeit abmelden.";

async function handleKeywords(inbox: Inbox, messages: InboundMessage[]) {
  const kind = inbox.kind as ChannelKind;
  for (const m of messages) {
    const stop = isStopMessage(m.text);
    const start = !stop && isStartMessage(m.text);
    if (!stop && !start) continue;
    const conv = await db.conversation.findUnique({ where: { inboxId_threadKey: { inboxId: inbox.id, threadKey: m.threadKey } }, select: { id: true, contactId: true } });
    if (!conv?.contactId) continue;
    // Doppelte Webhooks: nur einmal reagieren (Bestätigung bereits gesendet?)
    const marker = `kw:${m.externalId}`;
    const done = await db.message.findFirst({ where: { conversationId: conv.id, externalId: marker } });
    if (done) continue;
    await setOptOut(inbox.workspaceId, conv.contactId, kind, stop, `Antwort „${m.text.trim().slice(0, 20)}“`);
    // Bestätigung ist transaktional (Antwort auf die Abmeldung) – einmalig, im 24-h-Fenster
    const adapter = getChannelAdapter(inbox.provider);
    let status = "failed";
    let externalId: string | null = null;
    let error: string | undefined;
    try {
      const r = await adapter!.send(inbox, openCredentials(inbox), { to: [m.from], text: stop ? OPT_OUT_TEXT : OPT_IN_TEXT });
      externalId = r.externalId;
      status = r.externalId.startsWith("captured:") ? "captured" : "sent";
    } catch (e) {
      error = errMessage(e);
    }
    await db.message.create({
      data: { workspaceId: inbox.workspaceId, conversationId: conv.id, direction: "out", channel: kind, fromAddr: inbox.address, toAddrs: [m.from], bodyText: stop ? OPT_OUT_TEXT : OPT_IN_TEXT, externalId: externalId ?? marker, status, error },
    });
    // Merker für Idempotenz (falls externalId oben vom Anbieter stammt)
    if (externalId) {
      await db.message.create({ data: { workspaceId: inbox.workspaceId, conversationId: conv.id, direction: "note", channel: kind, bodyText: `Automatische ${stop ? "Abmeldung" : "Wieder-Anmeldung"} verarbeitet.`, externalId: marker, status: "sent" } });
    }
  }
}

export async function processWebhookPayload(inboxId: string, parsed: ParsedWebhook) {
  const inbox = await db.inbox.findUnique({ where: { id: inboxId } });
  if (!inbox) return { ingested: 0, updates: 0 };
  const creds = openCredentials(inbox);
  const messages: InboundMessage[] = [];
  for (const p of parsed.messages) {
    const m = toInbound(p, inbox.address);
    if (inbox.provider === "whatsapp_cloud" && p.media && creds.accessToken) {
      try {
        const f = await downloadWhatsAppMedia(p.media, creds.accessToken);
        m.attachments = [{ name: p.media.filename || `whatsapp-${p.media.id}`, mime: f.mime, content: f.data }];
      } catch (e) {
        log.warn("whatsapp media download failed", { inboxId, error: errMessage(e) });
      }
    }
    messages.push(m);
  }
  const result = messages.length ? await ingestInbound(inbox.id, messages) : null;
  const updates = await applyDeliveryUpdates(inbox.workspaceId, parsed.updates);
  if (messages.length) await handleKeywords(inbox, messages);
  await db.inbox.update({ where: { id: inbox.id }, data: { lastSyncAt: new Date(), status: "ok", lastError: null } });
  return { ingested: result?.created ?? 0, updates };
}
