import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { db } from "./db";
import { enqueue } from "./jobs";
import { isBlockedIp } from "./c-fetch";
import { configEventsFor } from "./mail-schema";
import { signWebhook } from "./webhook-sign";
import { errMessage, log } from "@/lib/log";

// Ausgehende Webhooks (Brevo-kompatible Payload). Zustellung über Job `webhook.deliver` mit Wiederholung.
// SSRF-Schutz: Ziel wird aufgelöst, interne Adressen sind verboten (außer WEBHOOK_ALLOW_PRIVATE=true in Entwicklung),
// die Verbindung geht fest an die geprüfte IP (kein DNS-Rebinding).

const TIMEOUT_MS = 10_000;

const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === "true" && process.env.NODE_ENV !== "production";

export function validateWebhookUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Ungültige URL";
  }
  if (u.username || u.password) return "URL darf keine Zugangsdaten enthalten";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && allowPrivate())) return "Nur https-URLs sind erlaubt";
  if (raw.length > 500) return "URL ist zu lang";
  return null;
}

async function resolveTarget(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedIp(host) && !allowPrivate()) throw new Error(`Ziel ${host} ist nicht erlaubt (internes Netz)`);
    return { address: host, family: isIP(host) };
  }
  const all = await lookup(host, { all: true, verbatim: true });
  if (all.length === 0) throw new Error(`Host ${host} nicht auflösbar`);
  if (!allowPrivate()) for (const a of all) if (isBlockedIp(a.address)) throw new Error(`Host ${host} zeigt auf internes Netz`);
  return all[0];
}

/** POST an die geprüfte IP. Folgt keinen Weiterleitungen. Liefert den HTTP-Status. */
export async function postPinned(rawUrl: string, body: string, headers: Record<string, string>): Promise<number> {
  const problem = validateWebhookUrl(rawUrl);
  if (problem) throw new Error(problem);
  const url = new URL(rawUrl);
  const ip = await resolveTarget(url.hostname);
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "user-agent": "Kundrio-Webhooks/1.0", ...headers },
        lookup: (_h, opts, cb) => {
          if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [ip]);
          else cb(null, ip.address, ip.family);
        },
        servername: isIP(url.hostname) ? undefined : url.hostname,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.resume(); // Antwort verwerfen, nur Status zählt
        res.on("end", () => resolve(res.statusCode ?? 0));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung (10 s)")));
    req.on("error", reject);
    req.end(body);
  });
}

export type MailEventPayload = {
  event: string; // intern/snake_case, z. B. "hard_bounce"
  email: string;
  messageId: string | null; // Message-ID-Header
  emailMessageId: string; // interne ID
  subject: string;
  tags: string[];
  templateId?: number | null;
  reason?: string | null;
  link?: string | null;
  at?: Date;
};

/** Reiht für alle passenden aktiven Webhooks eine Zustellung ein. Wirft nie. */
export async function emitMailEvent(workspaceId: string, type: "transactional" | "marketing", e: MailEventPayload) {
  try {
    const names = configEventsFor(e.event);
    if (names.length === 0) return;
    const hooks = await db.webhook.findMany({ where: { workspaceId, active: true, type, events: { hasSome: names } } });
    if (hooks.length === 0) return;
    const at = e.at ?? new Date();
    const body = {
      event: e.event,
      email: e.email,
      id: hooks[0].numericId,
      date: at.toISOString().replace("T", " ").slice(0, 19),
      ts: Math.floor(at.getTime() / 1000),
      ts_epoch: at.getTime(),
      ts_event: Math.floor(at.getTime() / 1000),
      "message-id": e.messageId,
      subject: e.subject,
      tag: e.tags[0] ?? "",
      tags: e.tags,
      template_id: e.templateId ?? undefined,
      reason: e.reason ?? undefined,
      link: e.link ?? undefined,
      "X-PD-Message-Id": e.emailMessageId,
    };
    for (const h of hooks) await enqueue("webhook.deliver", { webhookId: h.id, body: { ...body, id: h.numericId } });
  } catch (err) {
    log.error("webhook enqueue failed", { error: errMessage(err) });
  }
}

/** Zustellung eines Webhooks (vom Job aufgerufen). Wirft bei Fehler → Wiederholung mit Backoff. */
export async function deliverWebhook(webhookId: string, body: unknown) {
  const hook = await db.webhook.findUnique({ where: { id: webhookId } });
  if (!hook || !hook.active) return; // gelöscht/deaktiviert → nichts tun
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (hook.secret) headers["x-pd-signature"] = signWebhook(hook.secret, raw);
  let status = 0;
  let error: string | null = null;
  try {
    status = await postPinned(hook.url, raw, headers);
    if (status < 200 || status >= 300) error = `HTTP ${status}`;
  } catch (err) {
    error = String(err instanceof Error ? err.message : err).slice(0, 300);
  }
  await db.webhook.update({ where: { id: hook.id }, data: { lastStatus: status || null, lastError: error, lastAt: new Date() } });
  if (error) throw new Error(`Webhook ${hook.numericId}: ${error}`);
}
