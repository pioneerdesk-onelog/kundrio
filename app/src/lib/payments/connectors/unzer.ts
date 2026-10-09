// Unzer (Unzer GmbH, Heidelberg; BaFin-lizenziert) – gehostete Bezahlseite (Payment Page v1, Legacy) inkl. Wero.
// Doku: https://docs.unzer.com/online-payments/legacy/payment-pages-v1/integrate-epp/ ·
// Benachrichtigungen: https://docs.unzer.com/server-side-integration/api-basics/notifications/
// Unzer-Webhooks sind NICHT signiert → nur paymentId übernehmen, Zustand immer mit eigenem Schlüssel abfragen
// (retrieveUrl wird bewusst nie aufgerufen, damit kein fremder Host angefragt wird).
import { centsToDecimal, decimalToCents, requestJson } from "../http";
import { PaymentError, type Connector, type Credentials, type Mode, type PaymentStatus, type ProviderPayment } from "../types";

const base = (mode: Mode) => (process.env.UNZER_API_BASE || (mode === "live" ? "https://api.unzer.com/v1" : "https://sbx-api.unzer.com/v1")).replace(/\/$/, "");

const PAYMENT_ID = /^[sp]-pay-[A-Za-z0-9-]{1,60}$/;
const PAYPAGE_ID = /^[sp]-ppg-[A-Za-z0-9-]{1,80}$/;

type UnzerPayment = {
  id: string;
  state?: { id?: number; name?: string };
  amount?: { total?: string; charged?: string; canceled?: string; remaining?: string; currency?: string };
  currency?: string;
  orderId?: string;
  invoiceId?: string;
  resources?: { typeId?: string; metadataId?: string };
  transactions?: { date?: string; type?: string; status?: string; amount?: string }[];
};

// Präfix der Zahlart-Ressource → Zahlart
const TYPE_PREFIX: Record<string, string> = { wro: "wero", crd: "card", ppl: "paypal", ali: "alipay", apl: "applepay", gop: "googlepay", sdd: "sepadirectdebit", obt: "openbanking", ivc: "invoice", pit: "prepayment", eps: "eps", idl: "ideal", twt: "twint", pfc: "postfinance", kla: "klarna" };

function privateKey(c: Credentials) {
  const k = (c.privateKey ?? "").trim();
  if (!/^[sp]-priv-[A-Za-z0-9]{10,}$/.test(k)) throw new PaymentError("Unzer-Private-Key fehlt oder hat ein unbekanntes Format (s-priv-… / p-priv-…).");
  return k;
}

function headers(c: Credentials, extra: Record<string, string> = {}) {
  return { Authorization: `Basic ${Buffer.from(`${privateKey(c)}:`).toString("base64")}`, "Content-Type": "application/json", ...extra };
}

export function mapUnzer(p: UnzerPayment, checkoutUrl: string | null = null): ProviderPayment {
  const total = decimalToCents(p.amount?.total);
  const charged = decimalToCents(p.amount?.charged);
  const canceled = decimalToCents(p.amount?.canceled);
  const name = p.state?.name ?? "pending";
  let status: PaymentStatus;
  let refundedCents = 0;
  switch (name) {
    case "completed":
      refundedCents = Math.min(canceled, charged || total);
      status = refundedCents >= (charged || total) && refundedCents > 0 ? "refunded" : refundedCents > 0 ? "partially_refunded" : "paid";
      break;
    case "canceled":
      // Nach Belastung storniert = erstattet; sonst abgebrochen
      if (charged > 0) {
        refundedCents = charged;
        status = "refunded";
      } else status = "canceled";
      break;
    case "chargeback":
      refundedCents = charged || total;
      status = "refunded";
      break;
    case "partly":
    case "payment_review":
      status = "pending";
      break;
    default:
      status = "open";
  }
  const prefix = /^[sp]-([a-z]{3})-/.exec(p.resources?.typeId ?? "")?.[1];
  const paidTx = p.transactions?.find((t) => t.type === "charge" && t.status === "success");
  return {
    externalId: p.id,
    status,
    amountCents: total,
    currency: p.amount?.currency ?? p.currency ?? "EUR",
    refundedCents,
    method: prefix ? (TYPE_PREFIX[prefix] ?? prefix) : null,
    checkoutUrl,
    expiresAt: null,
    paidAt: status === "paid" || status === "partially_refunded" || status === "refunded" ? new Date(paidTx?.date ?? Date.now()) : null,
    test: p.id.startsWith("s-"),
  };
}

async function fetchPayment(c: Credentials, mode: Mode, id: string) {
  return requestJson<UnzerPayment>(`${base(mode)}/payments/${id}`, { headers: headers(c), secrets: [c.privateKey] });
}

export const unzer: Connector = {
  key: "unzer",
  label: "Unzer",
  company: "Unzer GmbH",
  country: "Deutschland",
  fields: [
    { name: "privateKey", label: "Private Key", secret: true, required: true, placeholder: "s-priv-… (Sandbox) oder p-priv-… (Live)", help: "Unzer Insights → Verwaltung → API-Schlüssel." },
    { name: "publicKey", label: "Public Key (optional)", placeholder: "s-pub-…", help: "Wenn gesetzt, werden nur Benachrichtigungen mit diesem Public Key angenommen." },
  ],
  knownMethods: [
    { id: "wero", label: "Wero" },
    { id: "card", label: "Karte" },
    { id: "paypal", label: "PayPal" },
    { id: "applepay", label: "Apple Pay" },
    { id: "googlepay", label: "Google Pay" },
    { id: "openbanking", label: "Direktüberweisung (Open Banking)" },
  ],
  webhookSetup: "api",
  detectMode: (c) => (c.privateKey?.startsWith("p-priv-") ? "live" : c.privateKey?.startsWith("s-priv-") ? "test" : null),

  async test(c, mode) {
    // Schlüsselpaar abfragen (Prüfung des Private Keys); Feldnamen laut Unzer-Doku nicht verifiziert → tolerant lesen
    const r = await requestJson<{ publicKey?: string; availablePaymentTypes?: string[]; paymentTypes?: { type?: string }[] }>(`${base(mode)}/keypair`, { headers: headers(c), secrets: [c.privateKey] });
    const types = r.availablePaymentTypes ?? r.paymentTypes?.map((t) => t.type ?? "").filter(Boolean) ?? [];
    return `Verbunden${r.publicKey ? ` (Public Key ${r.publicKey.slice(0, 10)}…)` : ""}${types.length ? ` – Zahlarten: ${types.join(", ")}` : ""}.`;
  },

  async create(c, mode, input) {
    const body: Record<string, unknown> = {
      amount: centsToDecimal(input.amountCents),
      currency: input.currency,
      returnUrl: input.returnUrl,
      orderId: input.metadata.paymentRef,
      invoiceId: input.description.slice(0, 256),
    };
    const r = await requestJson<{ id: string; redirectUrl?: string; resources?: { paymentId?: string } }>(`${base(mode)}/paypage/charge`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify(body),
      secrets: [c.privateKey],
    });
    const externalId = r.resources?.paymentId ?? r.id;
    if (!externalId || !(PAYMENT_ID.test(externalId) || PAYPAGE_ID.test(externalId))) throw new PaymentError("Unzer: unerwartete Antwort (keine Zahlungs-ID).");
    return {
      externalId,
      status: "open",
      amountCents: input.amountCents,
      currency: input.currency,
      refundedCents: 0,
      method: null,
      checkoutUrl: r.redirectUrl ?? null,
      expiresAt: null,
      paidAt: null,
      test: externalId.startsWith("s-"),
    };
  },

  async get(c, mode, externalId) {
    let id = externalId;
    if (PAYPAGE_ID.test(externalId)) {
      const pp = await requestJson<{ resources?: { paymentId?: string }; redirectUrl?: string; amount?: string; currency?: string }>(`${base(mode)}/paypage/${externalId}`, { headers: headers(c), secrets: [c.privateKey] });
      if (!pp.resources?.paymentId) {
        return { externalId, status: "open", amountCents: decimalToCents(pp.amount), currency: pp.currency ?? "EUR", refundedCents: 0, method: null, checkoutUrl: pp.redirectUrl ?? null, expiresAt: null, paidAt: null };
      }
      id = pp.resources.paymentId;
    }
    if (!PAYMENT_ID.test(id)) throw new PaymentError("Ungültige Unzer-Zahlungs-ID.");
    const p = mapUnzer(await fetchPayment(c, mode, id));
    // ID der Bezahlseite beibehalten, damit der Datensatz eindeutig bleibt
    return { ...p, externalId };
  },

  async refund(c, mode, externalId, amountCents, _currency, _idempotencyKey, description) {
    let id = externalId;
    if (PAYPAGE_ID.test(externalId)) {
      const pp = await requestJson<{ resources?: { paymentId?: string } }>(`${base(mode)}/paypage/${externalId}`, { headers: headers(c), secrets: [c.privateKey] });
      id = pp.resources?.paymentId ?? "";
    }
    if (!PAYMENT_ID.test(id)) throw new PaymentError("Ungültige Unzer-Zahlungs-ID.");
    // Erstattung = Storno der Belastung (Endpunkt laut Unzer „cancel after charge“; nicht live verifiziert)
    const r = await requestJson<{ id?: string; isSuccess?: boolean; isPending?: boolean }>(`${base(mode)}/payments/${id}/charges/cancels`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({ amount: centsToDecimal(amountCents), paymentReference: description.slice(0, 128) }),
      secrets: [c.privateKey],
    });
    return { refundId: r.id ?? "unzer-cancel", status: r.isSuccess ? "refunded" : r.isPending ? "pending" : "unknown" };
  },

  checkWebhook(c, { rawBody }) {
    try {
      const p = JSON.parse(rawBody) as { event?: string; publicKey?: string; paymentId?: string };
      if (c.publicKey && p.publicKey !== c.publicKey) return { ok: false, status: 401, reason: "unknown public key" };
      if (!p.paymentId) return { ok: true, externalIds: [] };
      if (!PAYMENT_ID.test(p.paymentId)) return { ok: false, status: 400, reason: "invalid payment id" };
      return { ok: true, externalIds: [p.paymentId] };
    } catch {
      return { ok: false, status: 400, reason: "invalid payload" };
    }
  },

  async registerWebhook(c, mode, url) {
    const r = await requestJson<{ id?: string; events?: { id?: string }[] }>(`${base(mode)}/webhooks`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({ url, eventList: ["payment", "charge"] }),
      secrets: [c.privateKey],
    });
    return { id: r.id ?? r.events?.[0]?.id ?? "registriert" };
  },
};
