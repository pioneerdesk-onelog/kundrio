import { z } from "zod";

// Validierung der Brevo-v3-kompatiblen Transaktions-Payload (POST /smtp/email).

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // dekodiert, gesamt
export const ALLOWED_ATTACHMENT_EXT = [
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "csv", "ics", "vcf",
  "xlsx", "xls", "docx", "doc", "pptx", "odt", "ods", "xml", "json", "zip",
];

const email = z.email().max(254);
const address = z.object({ email, name: z.string().max(200).optional() });

const attachment = z.object({
  name: z.string().min(1).max(200),
  content: z.string().max(14_000_000).optional(),
  url: z.string().optional(),
});

export const transactionalSchema = z
  .object({
    sender: z.object({ email: email.optional(), name: z.string().max(200).optional(), id: z.number().optional() }).optional(),
    to: z.array(address).min(1).max(50),
    cc: z.array(address).max(50).optional(),
    bcc: z.array(address).max(50).optional(),
    replyTo: address.optional(),
    subject: z.string().max(998).optional(),
    htmlContent: z.string().max(2_000_000).optional(),
    textContent: z.string().max(2_000_000).optional(),
    templateId: z.number().int().positive().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    headers: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    tags: z.array(z.string().max(100)).max(10).optional(),
    attachment: z.array(attachment).max(10).optional(),
    scheduledAt: z.string().max(40).optional(),
    messageVersions: z.unknown().optional(),
    batchId: z.string().optional(),
  })
  .passthrough();

export type TransactionalInput = z.infer<typeof transactionalSchema>;

export type ParsedAttachment = { filename: string; content: string /* base64 */; bytes: number };

export type CheckResult =
  | { ok: true; data: TransactionalInput; attachments: ParsedAttachment[]; headers: Record<string, string>; scheduledAt: Date | null }
  | { ok: false; code: string; message: string };

const SAFE_HEADER = /^X-[A-Za-z0-9-]{1,60}$/;
const RESERVED_HEADER = /^X-(PD|Mailin)-/i;

/** Prüft Payload + fachliche Regeln (Inhalt oder Vorlage, Anhänge, Header, Zeitplan). */
export function checkTransactional(raw: unknown, now = new Date()): CheckResult {
  const parsed = transactionalSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, code: "invalid_parameter", message: `${i.path.join(".") || "body"}: ${i.message}` };
  }
  const d = parsed.data;
  if (d.messageVersions !== undefined) {
    return { ok: false, code: "invalid_parameter", message: "messageVersions wird nicht unterstützt. Bitte je Empfängergruppe einen eigenen Aufruf senden." };
  }
  if (d.sender?.id !== undefined && !d.sender.email) {
    return { ok: false, code: "invalid_parameter", message: "sender.id wird nicht unterstützt. Bitte sender.email angeben." };
  }
  if (!d.templateId && !d.subject) return { ok: false, code: "missing_parameter", message: "subject is missing" };
  if (!d.templateId && !d.htmlContent && !d.textContent) {
    return { ok: false, code: "missing_parameter", message: "htmlContent or textContent is missing" };
  }

  const attachments: ParsedAttachment[] = [];
  let total = 0;
  for (const a of d.attachment ?? []) {
    if (a.url) return { ok: false, code: "invalid_parameter", message: "attachment.url wird nicht unterstützt. Bitte den Inhalt base64-kodiert in attachment.content senden." };
    if (!a.content) return { ok: false, code: "invalid_parameter", message: `attachment ${a.name}: content fehlt` };
    const ext = a.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_ATTACHMENT_EXT.includes(ext)) return { ok: false, code: "invalid_parameter", message: `attachment ${a.name}: Dateityp .${ext} ist nicht erlaubt` };
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(a.content)) return { ok: false, code: "invalid_parameter", message: `attachment ${a.name}: content ist kein Base64` };
    const bytes = Math.floor((a.content.replace(/[\r\n=]/g, "").length * 3) / 4);
    total += bytes;
    if (total > MAX_ATTACHMENT_BYTES) return { ok: false, code: "invalid_parameter", message: "Anhänge sind zusammen größer als 10 MB" };
    attachments.push({ filename: a.name.replace(/[\\/\r\n"]/g, "_"), content: a.content.replace(/[\r\n]/g, ""), bytes });
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.headers ?? {})) {
    // Brevo-Eigenheit: Idempotenz-/Sender-IP-Schlüssel werden ignoriert
    if (/^(idempotencyKey|sender\.ip)$/i.test(k)) continue;
    if (!SAFE_HEADER.test(k) || RESERVED_HEADER.test(k)) {
      return { ok: false, code: "invalid_parameter", message: `headers.${k}: nur eigene X-…-Header erlaubt` };
    }
    headers[k] = String(v).replace(/[\r\n]/g, " ").slice(0, 500);
  }

  let scheduledAt: Date | null = null;
  if (d.scheduledAt) {
    const t = new Date(d.scheduledAt);
    if (Number.isNaN(t.getTime())) return { ok: false, code: "invalid_parameter", message: "scheduledAt ist kein gültiges Datum (ISO 8601)" };
    if (t.getTime() > now.getTime() + 72 * 3600 * 1000) return { ok: false, code: "invalid_parameter", message: "scheduledAt darf höchstens 72 Stunden in der Zukunft liegen" };
    scheduledAt = t.getTime() > now.getTime() ? t : null;
  }

  return { ok: true, data: d, attachments, headers, scheduledAt };
}

/** Absender-Domain muss zur Workspace-Domain (inkl. Subdomains) oder zu einer erlaubten Domain passen. */
export function senderDomainAllowed(senderEmail: string, workspaceDomain: string | null, allowedOrigins: string[]): boolean {
  const domain = senderEmail.split("@").pop()?.toLowerCase() ?? "";
  if (!domain) return false;
  const allowed = new Set<string>();
  const add = (h: string | null | undefined) => {
    if (!h) return;
    const host = h.toLowerCase().replace(/^www\./, "");
    if (host) allowed.add(host);
  };
  add(workspaceDomain);
  for (const o of allowedOrigins) {
    try {
      add(new URL(o).hostname);
    } catch {
      add(o);
    }
  }
  for (const a of allowed) if (domain === a || domain.endsWith(`.${a}`)) return true;
  return false;
}

// Brevo-Webhook-Ereignisnamen (Konfiguration) ↔ interne Ereignisnamen (Payload)
export const WEBHOOK_EVENTS: Record<string, string> = {
  request: "request",
  sent: "request",
  delivered: "delivered",
  hardBounce: "hard_bounce",
  softBounce: "soft_bounce",
  blocked: "blocked",
  spam: "spam",
  invalid: "invalid",
  deferred: "deferred",
  click: "click",
  opened: "opened",
  uniqueOpened: "unique_opened",
  unsubscribed: "unsubscribed",
  error: "error",
};

export function configEventsFor(internalEvent: string): string[] {
  return Object.entries(WEBHOOK_EVENTS).filter(([, v]) => v === internalEvent).map(([k]) => k);
}

// Webhook-Verwaltung (Brevo-Format; `secret` ist eine Erweiterung für signierte Zustellung)
const eventName = z.enum(Object.keys(WEBHOOK_EVENTS) as [string, ...string[]]);
export const webhookCreateSchema = z.object({
  url: z.string().min(8).max(500),
  description: z.string().max(300).optional(),
  events: z.array(eventName).min(1).max(20),
  type: z.enum(["transactional", "marketing"]).default("transactional"),
  secret: z.string().min(16).max(200).optional(),
});
export const webhookUpdateSchema = webhookCreateSchema.partial().omit({ type: true });
