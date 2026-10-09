import "server-only";
import { db } from "../db";
import { enqueue } from "../jobs";
import { rateLimitAsync } from "../ratelimit";
import { openCredentials } from "../inbox/credentials";
import { parseSevenWebhook, parseWhatsAppWebhook, type ParsedWebhook } from "./parse";
import { verifyMetaSignature, verifySevenSignature } from "./signatures";
import { publicUrl } from "./seven-sms";

// Öffentlicher Webhook-Eingang: Signatur sofort prüfen, Inhalt als Job ablegen (Antwort < 1 s).

export const WEBHOOK_MAX_BYTES = 1024 * 1024;

export type WebhookOutcome = { status: number; body: string; contentType?: string };

export async function loadWebhookInbox(provider: string, inboxId: string) {
  if (!/^[a-z0-9_]{2,40}$/.test(provider) || !/^[a-z0-9]{10,40}$/.test(inboxId)) return null;
  return db.inbox.findFirst({ where: { id: inboxId, provider, active: true, kind: { in: ["whatsapp", "sms"] } } });
}

/** Meta-Verifizierung (GET): hub.mode=subscribe & hub.verify_token passt → hub.challenge zurückgeben. */
export async function handleVerification(provider: string, inboxId: string, url: URL): Promise<WebhookOutcome> {
  const inbox = await loadWebhookInbox(provider, inboxId);
  if (!inbox || provider !== "whatsapp_cloud") return { status: 404, body: "not found" };
  const creds = openCredentials(inbox);
  const ok = url.searchParams.get("hub.mode") === "subscribe" && Boolean(creds.verifyToken) && url.searchParams.get("hub.verify_token") === creds.verifyToken;
  if (!ok) return { status: 403, body: "forbidden" };
  return { status: 200, body: (url.searchParams.get("hub.challenge") ?? "").slice(0, 200), contentType: "text/plain" };
}

export function serializeParsed(p: ParsedWebhook) {
  return JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
}

export function reviveParsed(raw: unknown): ParsedWebhook {
  const p = (raw ?? {}) as ParsedWebhook;
  return {
    channelId: p.channelId,
    messages: (p.messages ?? []).map((m) => ({ ...m, receivedAt: new Date(m.receivedAt) })),
    updates: (p.updates ?? []).map((u) => ({ ...u, at: new Date(u.at) })),
  };
}

export async function handleWebhookPost(provider: string, inboxId: string, req: Request, rawBody: string, ip: string): Promise<WebhookOutcome> {
  if (!(await rateLimitAsync(`msgwh:${ip}`, 600, 60_000))) return { status: 429, body: "too many requests" };
  if (Buffer.byteLength(rawBody, "utf8") > WEBHOOK_MAX_BYTES) return { status: 413, body: "too large" };
  const inbox = await loadWebhookInbox(provider, inboxId);
  if (!inbox) return { status: 404, body: "not found" };
  const creds = openCredentials(inbox);

  let parsed: ParsedWebhook;
  try {
    if (provider === "whatsapp_cloud") {
      if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), creds.appSecret ?? "")) return { status: 401, body: "invalid signature" };
      parsed = parseWhatsAppWebhook(JSON.parse(rawBody));
      // Gehört die Nachricht wirklich zu dieser Nummer?
      const pnid = (inbox.config as { phoneNumberId?: string } | null)?.phoneNumberId;
      if (parsed.channelId && pnid && parsed.channelId !== pnid) return { status: 200, body: "ignored" };
    } else if (provider === "seven") {
      const nonce = req.headers.get("x-nonce");
      const v = verifySevenSignature({
        signature: req.headers.get("x-signature"),
        timestamp: req.headers.get("x-timestamp"),
        nonce,
        method: req.method,
        url: publicUrl(req),
        body: rawBody,
        secret: creds.signingSecret ?? "",
      });
      if (!v.ok) return { status: 401, body: "invalid signature" };
      // Wiederholungsschutz: jede Nonce nur einmal (Fenster 2 min)
      if (!(await rateLimitAsync(`msgnonce:${inbox.id}:${nonce}`, 1, 120_000))) return { status: 409, body: "replay" };
      parsed = parseSevenWebhook(JSON.parse(rawBody));
    } else {
      return { status: 404, body: "not found" };
    }
  } catch {
    return { status: 400, body: "invalid payload" };
  }

  if (parsed.messages.length || parsed.updates.length) {
    await enqueue("messaging.webhook", { inboxId: inbox.id, parsed: serializeParsed(parsed) });
  }
  return { status: 200, body: "ok" };
}
