// Gemeinsame Typen für Zahlungsanbieter (Bezahllinks). Reine Typen – Client und Server.

export const PROVIDER_KEYS = ["mollie", "revolut", "unzer"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];
export const isProviderKey = (v: unknown): v is ProviderKey => typeof v === "string" && (PROVIDER_KEYS as readonly string[]).includes(v);

export const PAYMENT_STATUSES = ["open", "pending", "authorized", "paid", "failed", "expired", "canceled", "refunded", "partially_refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Zahlung gilt als (noch) bezahlbar: Link wiederverwenden. */
export const OPEN_STATUSES: readonly PaymentStatus[] = ["open", "pending", "authorized"];
/** Geld ist eingegangen (ggf. teilweise erstattet). */
export const SETTLED_STATUSES: readonly PaymentStatus[] = ["paid", "partially_refunded", "refunded"];

export type Mode = "test" | "live";

/** Zugangsdaten je Anbieter (verschlüsselt gespeichert). Felder je Anbieter siehe `fields`. */
export type Credentials = Record<string, string>;

export type FieldDef = {
  name: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
};

export type CreateInput = {
  amountCents: number;
  currency: string;
  /** Rechnungsnummer – erscheint beim Kunden und im Kontoauszug */
  description: string;
  returnUrl: string;
  webhookUrl: string;
  /** eindeutiger Schlüssel gegen doppelte Anlage (z. B. bei Doppelklick) */
  idempotencyKey: string;
  metadata: { workspaceId: string; invoiceId: string; paymentRef: string };
  /** gewünschte Zahlart(en) – leer = Auswahl beim Anbieter */
  methods?: string[];
  customerEmail?: string | null;
};

/** Zustand einer Zahlung beim Anbieter (normalisiert). */
export type ProviderPayment = {
  externalId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  refundedCents: number;
  method: string | null;
  checkoutUrl: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
  /** Testzahlung (Sandbox) laut Anbieter */
  test?: boolean;
  metadata?: Record<string, unknown> | null;
};

export type WebhookInput = { headers: Headers; rawBody: string; now?: number };
/** Ergebnis der Webhook-Prüfung: nur IDs – der Zustand wird IMMER beim Anbieter abgefragt (Body nie vertrauen). */
export type WebhookCheck = { ok: true; externalIds: string[] } | { ok: false; status: number; reason: string };

export type RefundResult = { refundId: string; status: string };

export interface Connector {
  key: ProviderKey;
  label: string;
  /** Sitz/Regulierung für Souveränitäts-Cockpit */
  company: string;
  country: string;
  fields: FieldDef[];
  /** Zahlarten, die der Anbieter grundsätzlich kennt (Anzeige/Vorauswahl) */
  knownMethods: { id: string; label: string }[];
  /** Muss der Webhook beim Anbieter separat eingerichtet werden? (Mollie: nein, URL je Zahlung) */
  webhookSetup: "per_payment" | "api" | "manual";
  /** Erkennt Test-/Live-Zugang an den Zugangsdaten; null = unbekannt */
  detectMode(c: Credentials): Mode | null;
  test(c: Credentials, mode: Mode): Promise<string>;
  create(c: Credentials, mode: Mode, input: CreateInput): Promise<ProviderPayment>;
  get(c: Credentials, mode: Mode, externalId: string): Promise<ProviderPayment>;
  refund(c: Credentials, mode: Mode, externalId: string, amountCents: number, currency: string, idempotencyKey: string, description: string): Promise<RefundResult>;
  checkWebhook(c: Credentials, input: WebhookInput): WebhookCheck;
  /** Webhook per API einrichten (Revolut, Unzer); liefert ggf. neues Signatur-Geheimnis */
  registerWebhook?(c: Credentials, mode: Mode, url: string): Promise<{ id: string; signingSecret?: string }>;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly transient = false,
  ) {
    super(message);
  }
}
