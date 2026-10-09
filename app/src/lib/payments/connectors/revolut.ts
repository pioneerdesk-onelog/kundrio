// Revolut Merchant API (Revolut Bank UAB, Litauen; UK-Geschäft Revolut Ltd).
// OpenAPI-Spezifikation Version 2026-08-17: https://developer.revolut.com/docs/api/merchant
// Webhook-Signatur: Revolut-Signature = v1=<hex HMAC-SHA256(wsk_…, "v1.{Revolut-Request-Timestamp}.{rawBody}")>,
// Zeitstempel max. 5 Minuten alt (https://developer.revolut.com/docs/guides/merchant/monitor-and-observe/webhooks/verify-the-payload-signature).
import { createHmac } from "node:crypto";
import { requestJson } from "../http";
import { safeEqualStr } from "../crypto";
import { PaymentError, type Connector, type Credentials, type Mode, type PaymentStatus, type ProviderPayment } from "../types";

export const REVOLUT_EVENTS = ["ORDER_COMPLETED", "ORDER_AUTHORISED", "ORDER_CANCELLED", "ORDER_FAILED"];
const TOLERANCE_MS = 5 * 60_000;

const base = (mode: Mode) =>
  (process.env.REVOLUT_MERCHANT_BASE || (mode === "live" ? "https://merchant.revolut.com" : "https://sandbox-merchant.revolut.com")).replace(/\/$/, "");
const version = () => process.env.REVOLUT_MERCHANT_API_VERSION || "2026-08-17";

type RevolutOrder = {
  id: string;
  type?: string;
  state: string;
  amount: number;
  currency: string;
  outstanding_amount?: number;
  refunded_amount?: number;
  checkout_url?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  metadata?: Record<string, unknown> | null;
  payments?: { state?: string; payment_method?: { type?: string } }[];
};

function secretKey(c: Credentials) {
  const k = (c.secretKey ?? "").trim();
  if (!/^sk_[A-Za-z0-9_-]{10,}$/.test(k)) throw new PaymentError("Revolut-Secret-Key fehlt oder hat ein unbekanntes Format (sk_…).");
  return k;
}

function headers(c: Credentials, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${secretKey(c)}`, "Revolut-Api-Version": version(), "Content-Type": "application/json", ...extra };
}

export function mapRevolut(o: RevolutOrder): ProviderPayment {
  const refundedCents = o.refunded_amount ?? 0;
  let status: PaymentStatus;
  switch (o.state) {
    case "pending":
      status = "open";
      break;
    case "processing":
      status = "pending";
      break;
    case "authorised":
      status = "authorized";
      break;
    case "completed":
      status = refundedCents >= o.amount && o.amount > 0 ? "refunded" : refundedCents > 0 ? "partially_refunded" : "paid";
      break;
    case "cancelled":
      status = "canceled";
      break;
    case "failed":
      status = "failed";
      break;
    default:
      status = "pending";
  }
  const method = o.payments?.find((p) => p.state === "completed" || p.state === "captured")?.payment_method?.type ?? o.payments?.[0]?.payment_method?.type ?? null;
  return {
    externalId: o.id,
    status,
    amountCents: o.amount,
    currency: o.currency,
    refundedCents,
    method: method ? method.toLowerCase() : null,
    checkoutUrl: o.checkout_url ?? null,
    expiresAt: null,
    paidAt: status === "paid" || status === "partially_refunded" || status === "refunded" ? new Date(o.completed_at ?? o.updated_at ?? Date.now()) : null,
    metadata: o.metadata ?? null,
  };
}

/** Signatur prüfen (reine Funktion, testbar). Header kann mehrere Signaturen enthalten (Schlüsselrotation). */
export function verifyRevolutSignature(rawBody: string, signatureHeader: string | null, timestampHeader: string | null, secret: string, now = Date.now()): boolean {
  if (!signatureHeader || !timestampHeader || !secret) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_MS) return false;
  const expected = `v1=${createHmac("sha256", secret).update(`v1.${timestampHeader}.${rawBody}`).digest("hex")}`;
  return signatureHeader
    .split(",")
    .map((s) => s.trim())
    .some((s) => safeEqualStr(s, expected));
}

export const revolut: Connector = {
  key: "revolut",
  label: "Revolut Business (Merchant)",
  company: "Revolut Bank UAB",
  country: "Litauen (EU); Konzern Revolut Ltd, Vereinigtes Königreich",
  fields: [
    { name: "secretKey", label: "Secret API Key", secret: true, required: true, placeholder: "sk_…", help: "Revolut Business → Merchant → APIs. Für Tests den Sandbox-Key (sandbox-business.revolut.com) verwenden." },
    { name: "webhookSecret", label: "Webhook-Signing-Secret", secret: true, placeholder: "wsk_… (wird beim Einrichten automatisch gesetzt)", help: "Wird beim Klick auf „Webhook beim Anbieter einrichten“ automatisch übernommen." },
  ],
  knownMethods: [
    { id: "card", label: "Karte" },
    { id: "revolut_pay", label: "Revolut Pay" },
    { id: "apple_pay", label: "Apple Pay" },
    { id: "google_pay", label: "Google Pay" },
    { id: "pay_by_bank", label: "Pay by Bank" },
  ],
  webhookSetup: "api",
  detectMode: () => null,

  async test(c, mode) {
    const r = await requestJson<{ webhooks?: unknown[] } | unknown[]>(`${base(mode)}/api/webhooks`, { headers: headers(c), secrets: [c.secretKey] });
    const n = Array.isArray(r) ? r.length : (r.webhooks?.length ?? 0);
    return `Verbunden (${mode === "live" ? "Live" : "Sandbox"}) – ${n} Webhook(s) beim Anbieter eingerichtet.`;
  },

  async create(c, mode, input) {
    const body: Record<string, unknown> = {
      amount: input.amountCents,
      currency: input.currency,
      description: input.description.slice(0, 1024),
      merchant_order_data: { reference: input.description.slice(0, 100) },
      redirect_url: input.returnUrl,
      metadata: input.metadata,
    };
    if (input.customerEmail) body.customer = { email: input.customerEmail };
    const o = await requestJson<RevolutOrder>(`${base(mode)}/api/orders`, { method: "POST", headers: headers(c), body: JSON.stringify(body), secrets: [c.secretKey] });
    return mapRevolut(o);
  },

  async get(c, mode, externalId) {
    if (!/^[0-9a-f-]{20,40}$/i.test(externalId)) throw new PaymentError("Ungültige Revolut-Order-ID.");
    return mapRevolut(await requestJson<RevolutOrder>(`${base(mode)}/api/orders/${externalId}`, { headers: headers(c), secrets: [c.secretKey] }));
  },

  async refund(c, mode, externalId, amountCents, currency, idempotencyKey, description) {
    if (!/^[0-9a-f-]{20,40}$/i.test(externalId)) throw new PaymentError("Ungültige Revolut-Order-ID.");
    const r = await requestJson<RevolutOrder>(`${base(mode)}/api/orders/${externalId}/refund`, {
      method: "POST",
      headers: headers(c, { "Idempotency-Key": idempotencyKey.slice(0, 50) }),
      body: JSON.stringify({ amount: amountCents, currency, description: description.slice(0, 1024) }),
      secrets: [c.secretKey],
    });
    return { refundId: r.id, status: r.state };
  },

  checkWebhook(c, { headers: h, rawBody, now }) {
    if (!c.webhookSecret) return { ok: false, status: 401, reason: "no secret configured" };
    if (!verifyRevolutSignature(rawBody, h.get("revolut-signature"), h.get("revolut-request-timestamp"), c.webhookSecret, now)) {
      return { ok: false, status: 401, reason: "invalid signature" };
    }
    try {
      const p = JSON.parse(rawBody) as { event?: string; order_id?: string };
      if (!p.order_id || !/^[0-9a-f-]{20,40}$/i.test(p.order_id)) return { ok: true, externalIds: [] };
      return { ok: true, externalIds: [p.order_id] };
    } catch {
      return { ok: false, status: 400, reason: "invalid payload" };
    }
  },

  async registerWebhook(c, mode, url) {
    const r = await requestJson<{ id: string; signing_secret?: string }>(`${base(mode)}/api/webhooks`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({ url, events: REVOLUT_EVENTS }),
      secrets: [c.secretKey],
    });
    return { id: r.id, signingSecret: r.signing_secret };
  },
};
