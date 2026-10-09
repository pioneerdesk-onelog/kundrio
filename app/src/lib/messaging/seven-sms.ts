import { randomBytes } from "node:crypto";
import type { Inbox } from "@prisma/client";
import type { ChannelAdapter, SendResult } from "../inbox/channel";
import { providerFetch, ProviderError } from "./http";
import { captureResult, routeNumber } from "./mode";
import { parseSevenWebhook } from "./parse";
import { verifySevenSignature } from "./signatures";

// SMS über seven.io (seven communications GmbH, Deutschland).
// Senden: POST https://gateway.seven.io/api/sms (Header X-Api-Key) · Webhooks sms_mo/dlr signiert (X-Signature/X-Timestamp/X-Nonce)
// Doku: https://docs.seven.io/en/rest-api/endpoints/sms · https://docs.seven.io/en/rest-api/signing

export function sevenBase(env: Record<string, string | undefined> = process.env): string {
  return (env.SEVEN_API_BASE || "https://gateway.seven.io").replace(/\/+$/, "");
}

export type SevenConfig = { senderId?: string };
export type SevenCredentials = { apiKey?: string; signingSecret?: string };

function cfg(inbox: Pick<Inbox, "config">): SevenConfig {
  return (inbox.config && typeof inbox.config === "object" ? inbox.config : {}) as SevenConfig;
}

/** Absenderkennung: alphanumerisch max. 11 Zeichen oder Nummer (max. 16 Ziffern). Antworten sind nur an Nummern möglich. */
export function validSenderId(s: string): boolean {
  return /^[A-Za-z0-9 ._-]{1,11}$/.test(s) && /[A-Za-z]/.test(s) ? true : /^\+?\d{3,16}$/.test(s);
}

/** Öffentliche URL des Webhooks (die seven signiert). Hinter einem Proxy zählt APP_URL, nicht die interne Request-URL. */
export function publicUrl(req: Request, env: Record<string, string | undefined> = process.env): string {
  const u = new URL(req.url);
  const base = (env.APP_URL || u.origin).replace(/\/+$/, "");
  return `${base}${u.pathname}${u.search}`;
}

export const sevenSmsAdapter: ChannelAdapter = {
  kind: "sms",
  provider: "seven",
  label: "SMS über seven.io (DE)",
  capabilities: { subject: false, attachments: false, html: false, templates: false },

  async send(inbox, credentials, msg): Promise<SendResult> {
    const c = credentials as SevenCredentials;
    if (!c.apiKey) throw new ProviderError("API-Schlüssel fehlt in der Kanal-Einrichtung.", 400, false);
    const to = msg.to[0];
    if (!to) throw new ProviderError("Empfänger fehlt", 400, false);
    // Testmodus (MESSAGING_MODE=capture bzw. Nummer nicht auf der Freigabeliste): nichts an den Anbieter senden
    if (routeNumber(to) === "captured") return captureResult();
    const from = cfg(inbox).senderId || inbox.address;
    const foreignId = randomBytes(8).toString("hex");
    const r = await providerFetch(`${sevenBase()}/api/sms`, {
      method: "POST",
      headers: { "X-Api-Key": c.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to, text: msg.text.slice(0, 1530), from, foreign_id: foreignId }),
      secrets: [c.apiKey],
    });
    const j = (r.json ?? {}) as { success?: string | number; messages?: { id?: string | number; success?: boolean; error?: string | null }[] };
    const code = String(j.success ?? "");
    const first = (j.messages ?? [])[0];
    if (code !== "100" || !first || first.success === false || first.id == null) {
      throw new ProviderError(`SMS nicht angenommen (Code ${code || "?"}${first?.error ? `: ${first.error}` : ""})`, 502, false);
    }
    return { externalId: `seven:${first.id}`, status: "sent" };
  },

  async handleWebhook(_inbox, credentials, req, rawBody) {
    const c = credentials as SevenCredentials;
    const v = verifySevenSignature({
      signature: req.headers.get("x-signature"),
      timestamp: req.headers.get("x-timestamp"),
      nonce: req.headers.get("x-nonce"),
      method: req.method,
      url: publicUrl(req),
      body: rawBody,
      secret: c.signingSecret ?? "",
    });
    if (!v.ok) throw new ProviderError(`Webhook abgelehnt: ${v.reason}`, 401, false);
    const parsed = parseSevenWebhook(JSON.parse(rawBody));
    return {
      messages: parsed.messages.map((p) => ({ externalId: p.externalId, threadKey: p.from, from: p.from, to: [p.to ?? _inbox.address], text: p.text, receivedAt: p.receivedAt })),
      updates: parsed.updates,
    };
  },

  async test(_inbox, credentials) {
    const c = credentials as SevenCredentials;
    if (!c.apiKey) return { ok: false, detail: "API-Schlüssel fehlt" };
    try {
      const r = await providerFetch(`${sevenBase()}/api/balance`, { headers: { "X-Api-Key": c.apiKey, Accept: "application/json" }, secrets: [c.apiKey] });
      const j = (r.json ?? {}) as { amount?: number; currency?: string };
      return { ok: true, detail: `Verbunden. Guthaben: ${j.amount ?? "?"} ${j.currency ?? ""}`.trim() };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};
