import type { Inbox } from "@prisma/client";
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from "../inbox/channel";
import { providerBinary, providerFetch, ProviderError } from "./http";
import { captureResult, routeNumber } from "./mode";
import { parseWhatsAppWebhook, type MediaRef, type ParsedInbound } from "./parse";
import { verifyMetaSignature } from "./signatures";

// WhatsApp Business Platform – Cloud API (Meta) direkt.
// Senden: POST {graph}/{phone_number_id}/messages · Webhook-Signatur: X-Hub-Signature-256 (App-Secret)
// Doku: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages

export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;

export function graphBase(env: Record<string, string | undefined> = process.env): string {
  return (env.WHATSAPP_GRAPH_BASE || "https://graph.facebook.com/v25.0").replace(/\/+$/, "");
}

export type WaConfig = { phoneNumberId?: string; wabaId?: string };
export type WaCredentials = { accessToken?: string; appSecret?: string; verifyToken?: string };

function cfg(inbox: Pick<Inbox, "config">): WaConfig {
  return (inbox.config && typeof inbox.config === "object" ? inbox.config : {}) as WaConfig;
}

function need(v: string | undefined, label: string): string {
  if (!v) throw new ProviderError(`${label} fehlt in der Kanal-Einrichtung.`, 400, false);
  return v;
}

/** Nur Medien-URLs von Meta (bzw. vom konfigurierten Graph-Host, z. B. Testserver) abrufen. */
export function allowedMediaHost(url: string, env: Record<string, string | undefined> = process.env): boolean {
  try {
    const u = new URL(url);
    const graphHost = new URL(graphBase(env)).hostname;
    return (u.protocol === "https:" && (u.hostname === "lookaside.fbsbx.com" || u.hostname.endsWith(".fbsbx.com") || u.hostname === graphHost)) || u.hostname === graphHost;
  } catch {
    return false;
  }
}

export async function downloadWhatsAppMedia(media: MediaRef, token: string) {
  const meta = await providerFetch(`${graphBase()}/${encodeURIComponent(media.id)}`, { headers: { Authorization: `Bearer ${token}` }, secrets: [token] });
  const m = (meta.json ?? {}) as { url?: string; mime_type?: string; file_size?: number };
  if (!m.url || !allowedMediaHost(m.url)) throw new ProviderError("Unerwartete Medienadresse", 502, false);
  if ((m.file_size ?? 0) > MEDIA_MAX_BYTES) throw new ProviderError("Mediendatei zu groß", 413, false);
  const bin = await providerBinary(m.url, { Authorization: `Bearer ${token}` }, MEDIA_MAX_BYTES, [token]);
  return { data: bin.data, mime: m.mime_type || media.mime || bin.mime };
}

export function toInbound(p: ParsedInbound, ownNumber: string): InboundMessage {
  return { externalId: p.externalId, threadKey: p.from, from: p.from, fromName: p.fromName, to: [p.to ?? ownNumber], text: p.text, receivedAt: p.receivedAt };
}

export function buildWaPayload(to: string, msg: OutboundMessage) {
  if (msg.template) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: msg.template.name,
        language: { code: msg.template.language },
        ...(msg.template.params.length
          ? { components: [{ type: "body", parameters: msg.template.params.map((t) => ({ type: "text", text: t })) }] }
          : {}),
      },
    };
  }
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: msg.text.slice(0, 4096) } };
}

export async function listWhatsAppTemplates(inbox: Pick<Inbox, "config">, creds: WaCredentials) {
  const token = need(creds.accessToken, "Zugriffstoken");
  const waba = need(cfg(inbox).wabaId, "WhatsApp-Business-Konto-ID (WABA)");
  const r = await providerFetch(`${graphBase()}/${encodeURIComponent(waba)}/message_templates?fields=name,status,category,language&limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
    secrets: [token],
  });
  const data = ((r.json as { data?: unknown[] })?.data ?? []) as { name?: string; status?: string; category?: string; language?: string }[];
  return data.map((t) => ({ name: t.name ?? "", status: t.status ?? "", category: t.category ?? "", language: t.language ?? "" }));
}

export const whatsappCloudAdapter: ChannelAdapter = {
  kind: "whatsapp",
  provider: "whatsapp_cloud",
  label: "WhatsApp Business (Meta Cloud API)",
  capabilities: { subject: false, attachments: false, html: false, freeformWindowHours: 24, templates: true },

  async send(inbox, credentials, msg): Promise<SendResult> {
    const c = credentials as WaCredentials;
    const token = need(c.accessToken, "Zugriffstoken");
    const pnid = need(cfg(inbox).phoneNumberId, "Phone Number ID");
    const to = need(msg.to[0], "Empfänger");
    // Testmodus (MESSAGING_MODE=capture bzw. Nummer nicht auf der Freigabeliste): nichts an den Anbieter senden
    if (routeNumber(to) === "captured") return captureResult();
    const r = await providerFetch(`${graphBase()}/${encodeURIComponent(pnid)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildWaPayload(to, msg)),
      secrets: [token],
    });
    const id = ((r.json as { messages?: { id?: string }[] })?.messages ?? [])[0]?.id;
    if (!id) throw new ProviderError("Antwort ohne Nachrichten-ID", 502, true);
    return { externalId: id, status: "queued" };
  },

  async handleWebhook(inbox, credentials, req, rawBody) {
    const c = credentials as WaCredentials;
    if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), c.appSecret ?? "")) {
      throw new ProviderError("Ungültige Webhook-Signatur", 401, false);
    }
    const parsed = parseWhatsAppWebhook(JSON.parse(rawBody));
    const messages: InboundMessage[] = [];
    for (const p of parsed.messages) {
      const m = toInbound(p, inbox.address);
      if (p.media && c.accessToken) {
        try {
          const file = await downloadWhatsAppMedia(p.media, c.accessToken);
          m.attachments = [{ name: p.media.filename || `whatsapp-${p.media.id}`, mime: file.mime, content: file.data }];
        } catch {
          // Medien sind optional – Nachricht trotzdem übernehmen
        }
      }
      messages.push(m);
    }
    return { messages, updates: parsed.updates };
  },

  async test(inbox, credentials) {
    const c = credentials as WaCredentials;
    try {
      const token = need(c.accessToken, "Zugriffstoken");
      const pnid = need(cfg(inbox).phoneNumberId, "Phone Number ID");
      const r = await providerFetch(`${graphBase()}/${encodeURIComponent(pnid)}?fields=display_phone_number,verified_name,quality_rating`, {
        headers: { Authorization: `Bearer ${token}` },
        secrets: [token],
      });
      const j = (r.json ?? {}) as { display_phone_number?: string; verified_name?: string; quality_rating?: string };
      return { ok: true, detail: `Verbunden: ${j.verified_name ?? "?"} (${j.display_phone_number ?? "?"}), Qualität ${j.quality_rating ?? "unbekannt"}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};
