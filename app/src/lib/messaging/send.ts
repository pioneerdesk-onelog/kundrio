import "server-only";
import { db } from "../db";
import { log, errMessage } from "../log";
import { getChannelAdapter, type OutboundMessage } from "../inbox/channel";
import { openCredentials } from "../inbox/credentials";
import "./register";
import { consentState } from "./consent";
import { isCaptured, parseNumberAllowlist, messagingMode, routeNumber } from "./mode";
import { toE164 } from "./phone";
import { checkSend, type ChannelKind, type Purpose } from "./rules";

// Versand über WhatsApp/SMS für Prozesse, Kampagnen, MCP und die Oberfläche.
// Prüft Einwilligung (Werbung), Abmeldung, 24-h-Fenster (WhatsApp) und Testmodus.

export type ChannelSendInput = {
  contactId: string;
  kind: ChannelKind;
  text?: string;
  template?: { name: string; language: string; params: string[] };
  purpose: Purpose;
  /** bestimmter Kanal (sonst erster aktiver des Typs im Sub-Account) */
  inboxId?: string;
};

export class ChannelSendError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

function userIdOf(actor: string): string | null {
  const m = actor.match(/(?:^|:)user:([A-Za-z0-9_-]+)$/) ?? actor.match(/^user:([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function lastInboundAt(inboxId: string, threadKey: string): Promise<Date | null> {
  const conv = await db.conversation.findUnique({ where: { inboxId_threadKey: { inboxId, threadKey } }, select: { id: true } });
  if (!conv) return null;
  const m = await db.message.findFirst({ where: { conversationId: conv.id, direction: "in" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return m?.createdAt ?? null;
}

export async function sendChannelMessage(workspaceId: string, input: ChannelSendInput, actor: string) {
  const contact = await db.contact.findFirst({
    where: { id: input.contactId, workspaceId },
    select: { id: true, phone: true, firstName: true, smsConsentAt: true, whatsappConsentAt: true, whatsappOptOutAt: true, attributes: true },
  });
  if (!contact) throw new ChannelSendError("Kontakt nicht gefunden.", "not_found");
  const inbox = await db.inbox.findFirst({
    where: { workspaceId, kind: input.kind, active: true, ...(input.inboxId ? { id: input.inboxId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!inbox) throw new ChannelSendError(`Kein aktiver ${input.kind === "whatsapp" ? "WhatsApp" : "SMS"}-Kanal eingerichtet.`, "no_channel");
  const adapter = getChannelAdapter(inbox.provider);
  if (!adapter) throw new ChannelSendError(`Kanal-Anbieter „${inbox.provider}“ ist nicht verfügbar.`, "no_adapter");

  const to = toE164(contact.phone);
  const usesTemplate = Boolean(input.template);
  if (!usesTemplate && !input.text?.trim()) throw new ChannelSendError("Nachrichtentext fehlt.", "empty");
  if (input.kind === "sms" && usesTemplate) throw new ChannelSendError("SMS kennt keine Vorlagen – bitte Text senden.", "invalid");
  const check = checkSend({
    kind: input.kind,
    purpose: input.purpose,
    hasNumber: Boolean(to),
    consent: consentState(contact),
    lastInboundAt: to ? await lastInboundAt(inbox.id, to) : null,
    usesTemplate,
  });
  if (!check.ok) throw new ChannelSendError(check.message, check.code);

  const msg: OutboundMessage = { to: [to!], text: input.text?.trim() ?? `[Vorlage ${input.template!.name}]`, template: input.template };
  let externalId: string | null = null;
  let status = "sent";
  let error: string | undefined;
  try {
    const r = await adapter.send(inbox, openCredentials(inbox), msg);
    externalId = r.externalId;
    status = isCaptured(r.externalId) ? "captured" : r.status === "queued" ? "queued" : "sent";
  } catch (e) {
    status = "failed";
    error = errMessage(e);
    log.warn("messaging send failed", { inboxId: inbox.id, kind: input.kind, error });
  }

  const conv = await db.conversation.upsert({
    where: { inboxId_threadKey: { inboxId: inbox.id, threadKey: to! } },
    create: { workspaceId, inboxId: inbox.id, threadKey: to!, contactId: contact.id, status: "pending", lastMessageAt: new Date() },
    update: { lastMessageAt: new Date(), contactId: contact.id },
  });
  const message = await db.message.create({
    data: {
      workspaceId,
      conversationId: conv.id,
      direction: "out",
      channel: input.kind,
      fromAddr: inbox.address,
      toAddrs: [to!],
      bodyText: msg.text,
      externalId,
      status,
      error,
      sentById: userIdOf(actor),
    },
  });
  await db.activity.create({
    data: {
      workspaceId,
      contactId: contact.id,
      type: "SYSTEM",
      body: `${input.kind === "whatsapp" ? "WhatsApp" : "SMS"} ${status === "failed" ? "fehlgeschlagen" : status === "captured" ? "(Testmodus, nicht gesendet)" : "gesendet"}: ${msg.text.slice(0, 120)}`,
      meta: { channel: input.kind, purpose: input.purpose, messageId: message.id, status, actor },
    },
  });
  if (status === "failed") throw new ChannelSendError(`Versand fehlgeschlagen: ${error}`, "provider");
  return { messageId: message.id, conversationId: conv.id, status };
}

/** Testnachricht an eine Nummer (Einrichtung). Live nur an Nummern der Freigabeliste. */
export async function sendTestMessage(workspaceId: string, inboxId: string, rawTo: string, text: string) {
  const inbox = await db.inbox.findFirst({ where: { id: inboxId, workspaceId } });
  if (!inbox) throw new ChannelSendError("Kanal nicht gefunden.", "not_found");
  const to = toE164(rawTo);
  if (!to) throw new ChannelSendError("Ungültige Rufnummer.", "invalid");
  if (messagingMode() === "live") {
    const list = parseNumberAllowlist(process.env.MESSAGING_LIVE_ALLOWLIST);
    if (!list || !list.includes(to)) throw new ChannelSendError("Testnachrichten gehen im Live-Modus nur an Nummern aus MESSAGING_LIVE_ALLOWLIST.", "not_allowed");
  }
  const adapter = getChannelAdapter(inbox.provider);
  if (!adapter) throw new ChannelSendError("Kanal-Anbieter nicht verfügbar.", "no_adapter");
  const r = await adapter.send(inbox, openCredentials(inbox), { to: [to], text: text.slice(0, 1000) });
  return { delivery: routeNumber(to) === "live" && !isCaptured(r.externalId) ? "live" : "captured", externalId: r.externalId };
}
