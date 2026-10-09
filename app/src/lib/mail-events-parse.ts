// Reine Normalisierung von Relay-Ereignissen (ohne DB), testbar.

export type RelayEvent = {
  event: string; // intern
  email: string;
  messageIdHeader: string | null;
  pdId: string | null; // aus X-Mailin-custom "pd:<id>"
  reason: string | null;
  link: string | null;
  at: Date;
};

// Brevo-Relay-Ereignisnamen → intern
const BREVO_MAP: Record<string, string> = {
  request: "request",
  delivered: "delivered",
  deferred: "deferred",
  soft_bounce: "soft_bounce",
  hard_bounce: "hard_bounce",
  blocked: "blocked",
  spam: "spam",
  complaint: "spam",
  invalid_email: "invalid",
  invalid: "invalid",
  error: "error",
  click: "click",
  opened: "opened",
  unique_opened: "unique_opened",
  proxy_open: "opened",
  unsubscribed: "unsubscribed",
};

/** Normalisiert eine Brevo-Webhook-Nutzlast. Liefert null bei unbekanntem/unbrauchbarem Ereignis. */
export function parseBrevoEvent(raw: Record<string, unknown>): RelayEvent | null {
  const name = String(raw.event ?? "").toLowerCase();
  const event = BREVO_MAP[name];
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (!event || !email) return null;
  const custom = String(raw["X-Mailin-custom"] ?? raw["x-mailin-custom"] ?? "");
  const pdId = custom.match(/pd:([a-z0-9]{20,40})/i)?.[1] ?? null;
  const mid = typeof raw["message-id"] === "string" ? (raw["message-id"] as string) : null;
  const tsEpoch = Number(raw.ts_epoch ?? 0);
  const ts = Number(raw.ts_event ?? raw.ts ?? 0);
  const at = tsEpoch > 1e12 ? new Date(tsEpoch) : ts > 1e9 ? new Date(ts * 1000) : new Date();
  return {
    event,
    email,
    messageIdHeader: mid ? (mid.startsWith("<") ? mid : `<${mid}>`) : null,
    pdId,
    reason: typeof raw.reason === "string" ? raw.reason.slice(0, 300) : null,
    link: typeof raw.link === "string" ? raw.link.slice(0, 500) : null,
    at,
  };
}

