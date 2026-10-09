import "server-only";
import type { EmailTemplate } from "@prisma/client";
import { ApiAuthError, apiError, authenticateApiKey, type ApiAuth, type Scope } from "./apikey";
import { errMessage, log } from "@/lib/log";

// Gemeinsame Hülle für die Brevo-kompatiblen Endpunkte: Schlüssel prüfen, Fehler im Brevo-Format.

export async function withApiKey(req: Request, scope: Scope, fn: (auth: ApiAuth) => Promise<Response>): Promise<Response> {
  let auth: ApiAuth;
  try {
    auth = await authenticateApiKey(req, scope);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      const code = err.status === 401 ? "unauthorized" : err.status === 403 ? "permission_denied" : "too_many_requests";
      return apiError(err.status, code, err.message);
    }
    throw err;
  }
  try {
    return await fn(auth);
  } catch (err) {
    log.error("mail api error", { error: errMessage(err) });
    return apiError(500, "internal_error", "Internal error");
  }
}

/** JSON lesen mit Größenlimit. Liefert Response bei Fehler. */
export async function readJson(req: Request, maxBytes: number): Promise<{ ok: true; data: unknown } | { ok: false; res: Response }> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) return { ok: false, res: apiError(413, "payload_too_large", `Request body larger than ${Math.round(maxBytes / 1e6)} MB`) };
  const text = await req.text();
  if (text.length > maxBytes) return { ok: false, res: apiError(413, "payload_too_large", `Request body larger than ${Math.round(maxBytes / 1e6)} MB`) };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, res: apiError(400, "bad_request", "Invalid JSON") };
  }
}

export function intParam(v: string | null, def: number, min: number, max: number) {
  const n = Number(v);
  if (!v || !Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Brevo-Datumsformat für Listen: ISO ohne Millisekunden */
export const iso = (d: Date) => d.toISOString();

export function toBrevoTemplate(t: EmailTemplate) {
  return {
    id: t.numericId,
    name: t.name,
    subject: t.subject,
    isActive: t.isActive,
    testSent: false,
    sender: { name: t.senderName ?? "", email: t.senderEmail ?? "", id: null },
    replyTo: t.replyTo ?? "",
    toField: "",
    tag: "",
    htmlContent: t.html,
    createdAt: iso(t.createdAt),
    modifiedAt: iso(t.updatedAt),
  };
}

// Interne Ereignisnamen ↔ Brevo-Statistik-Namen (GET /smtp/statistics/events)
export const STAT_EVENT: Record<string, string> = {
  request: "requests",
  delivered: "delivered",
  hard_bounce: "hardBounces",
  soft_bounce: "softBounces",
  blocked: "blocked",
  spam: "spam",
  invalid: "invalid",
  deferred: "deferred",
  opened: "opened",
  unique_opened: "opened",
  click: "clicks",
  unsubscribed: "unsubscribed",
  error: "error",
};
