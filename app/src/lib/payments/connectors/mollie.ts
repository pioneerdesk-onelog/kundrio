// Mollie Payments API v2 (Mollie B.V., Amsterdam; DNB-lizenziertes Zahlungsinstitut).
// Doku: https://docs.mollie.com/reference/create-payment · Webhooks: https://docs.mollie.com/reference/webhooks
// Webhook-Body enthält nur `id=tr_…` → Status wird immer per GET abgefragt (Body nie vertrauen).
import { centsToDecimal, decimalToCents, isHttps, requestJson } from "../http";
import { PaymentError, type Connector, type Credentials, type Mode, type PaymentStatus, type ProviderPayment } from "../types";

const base = () => (process.env.MOLLIE_API_BASE || "https://api.mollie.com/v2").replace(/\/$/, "");

type Amount = { currency: string; value: string };
type MolliePayment = {
  id: string;
  mode?: "test" | "live";
  status: string;
  amount: Amount;
  amountRefunded?: Amount;
  amountChargedBack?: Amount;
  method?: string | null;
  paidAt?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
  _links?: { checkout?: { href: string } };
};

function key(c: Credentials) {
  const k = (c.apiKey ?? "").trim();
  if (!/^(test|live)_[A-Za-z0-9]{20,}$/.test(k)) throw new PaymentError("Mollie-API-Schlüssel fehlt oder hat ein unbekanntes Format (test_… oder live_…).");
  return k;
}

function headers(c: Credentials, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${key(c)}`, "Content-Type": "application/json", ...extra };
}

export function mapMollie(p: MolliePayment): ProviderPayment {
  const amountCents = decimalToCents(p.amount?.value);
  const refundedCents = decimalToCents(p.amountRefunded?.value) + decimalToCents(p.amountChargedBack?.value);
  let status: PaymentStatus;
  switch (p.status) {
    case "open":
    case "pending":
    case "authorized":
    case "canceled":
    case "expired":
    case "failed":
      status = p.status;
      break;
    case "paid":
      status = refundedCents >= amountCents && amountCents > 0 ? "refunded" : refundedCents > 0 ? "partially_refunded" : "paid";
      break;
    default:
      status = "pending";
  }
  return {
    externalId: p.id,
    status,
    amountCents,
    currency: p.amount?.currency ?? "EUR",
    refundedCents,
    method: p.method ?? null,
    checkoutUrl: p._links?.checkout?.href ?? null,
    expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
    paidAt: p.paidAt ? new Date(p.paidAt) : null,
    test: p.mode === "test",
    metadata: p.metadata ?? null,
  };
}

/** Mollie lehnt nicht erreichbare Webhook-URLs ab (z. B. localhost) – dann ohne Webhook, Abgleich per Abfrage. */
function publicWebhook(url: string) {
  if (!isHttps(url)) return undefined;
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h.startsWith("127.") || h.endsWith(".local") ? undefined : url;
  } catch {
    return undefined;
  }
}

export const mollie: Connector = {
  key: "mollie",
  label: "Mollie",
  company: "Mollie B.V.",
  country: "Niederlande (EU)",
  fields: [{ name: "apiKey", label: "API-Schlüssel", secret: true, required: true, placeholder: "test_… oder live_…", help: "Mollie-Dashboard → Entwickler → API-Schlüssel. Test-Schlüssel für Probezahlungen." }],
  knownMethods: [
    { id: "wero", label: "Wero" },
    { id: "creditcard", label: "Kreditkarte" },
    { id: "applepay", label: "Apple Pay" },
    { id: "paypal", label: "PayPal" },
    { id: "klarna", label: "Klarna" },
    { id: "banktransfer", label: "Überweisung" },
    { id: "ideal", label: "iDEAL" },
    { id: "bancontact", label: "Bancontact" },
  ],
  webhookSetup: "per_payment",
  detectMode: (c) => (c.apiKey?.startsWith("live_") ? "live" : c.apiKey?.startsWith("test_") ? "test" : null),

  async test(c) {
    const r = await requestJson<{ _embedded?: { methods?: { id: string; description: string }[] } }>(`${base()}/methods?locale=de_DE`, { headers: headers(c), secrets: [c.apiKey] });
    const m = r._embedded?.methods ?? [];
    return m.length ? `Verbunden – aktive Zahlarten: ${m.map((x) => x.description || x.id).join(", ")}` : "Verbunden – im Mollie-Dashboard sind noch keine Zahlarten aktiviert.";
  },

  async create(c, _mode: Mode, input) {
    const body: Record<string, unknown> = {
      amount: { currency: input.currency, value: centsToDecimal(input.amountCents) },
      description: input.description.slice(0, 255),
      redirectUrl: input.returnUrl,
      metadata: input.metadata,
      locale: "de_DE",
    };
    const wh = publicWebhook(input.webhookUrl);
    if (wh) body.webhookUrl = wh;
    if (input.methods?.length) body.method = input.methods.length === 1 ? input.methods[0] : input.methods;
    const p = await requestJson<MolliePayment>(`${base()}/payments`, {
      method: "POST",
      headers: headers(c, { "Idempotency-Key": input.idempotencyKey }),
      body: JSON.stringify(body),
      secrets: [c.apiKey],
    });
    return mapMollie(p);
  },

  async get(c, _mode, externalId) {
    if (!/^tr_[A-Za-z0-9]+$/.test(externalId)) throw new PaymentError("Ungültige Mollie-Zahlungs-ID.");
    return mapMollie(await requestJson<MolliePayment>(`${base()}/payments/${externalId}`, { headers: headers(c), secrets: [c.apiKey] }));
  },

  async refund(c, _mode, externalId, amountCents, currency, idempotencyKey, description) {
    if (!/^tr_[A-Za-z0-9]+$/.test(externalId)) throw new PaymentError("Ungültige Mollie-Zahlungs-ID.");
    const r = await requestJson<{ id: string; status: string }>(`${base()}/payments/${externalId}/refunds`, {
      method: "POST",
      headers: headers(c, { "Idempotency-Key": idempotencyKey }),
      body: JSON.stringify({ amount: { currency, value: centsToDecimal(amountCents) }, description: description.slice(0, 255) }),
      secrets: [c.apiKey],
    });
    return { refundId: r.id, status: r.status };
  },

  checkWebhook(_c, { rawBody }) {
    // Klassische Mollie-Webhooks sind unsigniert: nur die ID wird übernommen, Status per API (mit unserem Schlüssel)
    const id = new URLSearchParams(rawBody).get("id") ?? "";
    if (!/^tr_[A-Za-z0-9]{4,40}$/.test(id)) return { ok: false, status: 400, reason: "invalid id" };
    return { ok: true, externalIds: [id] };
  },
};
