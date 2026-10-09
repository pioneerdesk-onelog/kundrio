import { createHmac, timingSafeEqual } from "node:crypto";

// Signatur ausgehender Webhooks: X-PD-Signature: sha256=<hex hmac(secret, rawBody)>
export function signWebhook(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function verifyWebhookSignature(secret: string, body: string, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(signWebhook(secret, body));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Konstantzeit-Vergleich für Geheimnisse (z. B. MAIL_EVENTS_SECRET). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
