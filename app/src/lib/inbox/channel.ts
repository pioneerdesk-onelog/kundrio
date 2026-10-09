import type { Inbox } from "@prisma/client";

// Gemeinsame Kanal-Schnittstelle des Posteingangs. E-Mail, WhatsApp, SMS (später Web-Chat) liefern
// eingehende Nachrichten in diesem Format; der Posteingang (src/lib/inbox/ingest.ts) ordnet sie
// Kontakten und Gesprächen zu. Ausgehend ruft der Posteingang adapter.send() auf.

export type InboundAttachment = { name: string; mime: string; content: Buffer };

export type InboundMessage = {
  /** Message-ID bzw. Anbieter-ID – dient zum Entdoppeln */
  externalId: string;
  /** Gesprächsschlüssel: E-Mail-Thread-Wurzel (References[0] bzw. eigene Message-ID), Rufnummer E.164, … */
  threadKey: string;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  subject?: string;
  text: string;
  /** Roh-HTML – wird vom Posteingang vor Anzeige bereinigt */
  html?: string;
  inReplyTo?: string;
  references?: string[];
  receivedAt: Date;
  attachments?: InboundAttachment[];
  /** optional (abwärtskompatibel): vom Adapter aus Headern erkannt – Abwesenheitsnotiz/Autoresponder bzw. Spam */
  flags?: { autoReply?: boolean; spam?: boolean };
};

/** Statusmeldung eines Anbieters zu einer gesendeten Nachricht (Webhook) */
export type DeliveryUpdate = { externalId: string; status: "sent" | "delivered" | "read" | "failed"; error?: string; at: Date };

export type OutboundMessage = {
  to: string[];
  cc?: string[];
  subject?: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { name: string; mime: string; content: Buffer }[];
  /** WhatsApp: freigegebene Vorlage (außerhalb des 24-h-Fensters Pflicht) */
  template?: { name: string; language: string; params: string[] };
};

export type SendResult = { externalId: string; status: "queued" | "sent" | "captured" };

export type ChannelCapabilities = {
  subject: boolean;
  attachments: boolean;
  html: boolean;
  /** Freitext nur innerhalb dieses Fensters nach der letzten eingehenden Nachricht (WhatsApp: 24) */
  freeformWindowHours?: number;
  templates: boolean;
};

export interface ChannelAdapter {
  kind: "email" | "whatsapp" | "sms" | "webchat";
  provider: string;
  label: string;
  capabilities: ChannelCapabilities;
  /** Abruf per Polling (z. B. IMAP); Webhook-Kanäle lassen das weg */
  fetchNew?(inbox: Inbox, credentials: Record<string, string>): Promise<InboundMessage[]>;
  send(inbox: Inbox, credentials: Record<string, string>, msg: OutboundMessage): Promise<SendResult>;
  /** Webhook verarbeiten: Signatur prüfen und Nachrichten/Statusmeldungen liefern */
  handleWebhook?(inbox: Inbox, credentials: Record<string, string>, req: Request, rawBody: string): Promise<{ messages: InboundMessage[]; updates: DeliveryUpdate[] }>;
  /** Verbindung testen (lesend) */
  test?(inbox: Inbox, credentials: Record<string, string>): Promise<{ ok: boolean; detail: string }>;
}

const adapters = new Map<string, ChannelAdapter>();

export function registerChannelAdapter(a: ChannelAdapter) {
  adapters.set(a.provider, a);
}

export function getChannelAdapter(provider: string): ChannelAdapter | undefined {
  return adapters.get(provider);
}

export function listChannelAdapters(): ChannelAdapter[] {
  return [...adapters.values()];
}
