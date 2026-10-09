import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Webhook-Signaturen (rein, testbar).

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Meta: Header `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(rohBody, AppSecret)>`. */
export function signMeta(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

export function verifyMetaSignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  return safeEqualHex(header.trim(), signMeta(rawBody, appSecret));
}

/**
 * seven.io: X-Signature = hex HMAC-SHA256(Signierschlüssel, Timestamp\nNonce\nMETHODE\nZiel-URL\nMD5(Body)).
 * Zeitstempel höchstens 30 s alt (Doku); Nonce zusätzlich gegen Wiederholung prüfen (Aufrufer).
 */
export function signSeven(input: { timestamp: string; nonce: string; method: string; url: string; body: string; secret: string }): string {
  const md5 = createHash("md5").update(input.body, "utf8").digest("hex");
  const data = [input.timestamp, input.nonce, input.method.toUpperCase(), input.url, md5].join("\n");
  return createHmac("sha256", input.secret).update(data, "utf8").digest("hex");
}

export function verifySevenSignature(input: {
  signature: string | null;
  timestamp: string | null;
  nonce: string | null;
  method: string;
  url: string;
  body: string;
  secret: string;
  now?: number;
  maxAgeSec?: number;
}): { ok: boolean; reason?: string } {
  if (!input.signature || !input.timestamp || !input.nonce || !input.secret) return { ok: false, reason: "Signatur-Header fehlen" };
  const ts = Number(input.timestamp);
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (input.maxAgeSec ?? 30)) return { ok: false, reason: "Zeitstempel abgelaufen" };
  if (!/^[A-Za-z0-9]{16,64}$/.test(input.nonce)) return { ok: false, reason: "Nonce ungültig" };
  const expected = signSeven({ timestamp: input.timestamp, nonce: input.nonce, method: input.method, url: input.url, body: input.body, secret: input.secret });
  return safeEqualHex(input.signature.trim().toLowerCase(), expected) ? { ok: true } : { ok: false, reason: "Signatur ungültig" };
}
