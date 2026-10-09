import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { enqueue } from "../jobs";
import { audit } from "../audit";
import { formatCents } from "../invoice";
import { emitInvoicePaid } from "./paid-event";
import { errMessage, log } from "../log";
import { rateLimitAsync } from "../ratelimit";
import { maskSecret, openCredentials, payToken, sealCredentials } from "./crypto";
import { getConnector, liveAllowed } from "./registry";
import { invoiceTransition, onlineNetCents, bankNetCents, STATUS_LABEL } from "./settlement";
import { OPEN_STATUSES, PaymentError, isProviderKey, type Credentials, type Mode, type PaymentStatus, type ProviderKey, type ProviderPayment } from "./types";

// Zahlungen: Anbieter verbinden, Bezahllinks erzeugen, Webhooks verarbeiten, Rechnungsstatus fortschreiben.
// Grundsätze: Zustand immer beim Anbieter abfragen (nie dem Webhook-Body vertrauen), jede Statusänderung
// genau einmal anwenden (bedingtes Update), Rechnung nur bei vollständiger Zahlung auf PAID.

type Tx = Prisma.TransactionClient | PrismaClient;

export class PaymentsError extends Error {}

export const WEBHOOK_MAX_BYTES = 64 * 1024;

export function publicBase() {
  return (process.env.PAYMENTS_PUBLIC_URL || env.appUrl()).replace(/\/$/, "");
}

export function webhookUrlFor(provider: string, providerRowId: string) {
  return `${publicBase()}/api/payments/${provider}/${providerRowId}`;
}

export function payPageUrl(invoiceId: string) {
  return `${publicBase()}/zahlung/${payToken(invoiceId)}`;
}

// ---------- Anbieter verwalten ----------

export async function listProviders(workspaceId: string) {
  const rows = await db.paymentProvider.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => {
    const conn = getConnector(r.provider);
    const creds = openCredentials(r.credentials);
    return {
      id: r.id,
      provider: r.provider as ProviderKey,
      label: conn?.label ?? r.provider,
      mode: r.mode as Mode,
      methods: r.methods,
      active: r.active,
      isDefault: r.isDefault,
      status: r.status,
      lastError: r.lastError,
      webhookUrl: webhookUrlFor(r.provider, r.id),
      // nur maskiert anzeigen
      masked: Object.fromEntries((conn?.fields ?? []).map((f) => [f.name, f.secret ? maskSecret(creds[f.name]) : (creds[f.name] ?? "")])),
    };
  });
}

export type ProviderInput = { provider: string; mode: Mode; credentials: Credentials; methods: string[]; active: boolean; isDefault: boolean };

export async function saveProvider(workspaceId: string, input: ProviderInput, actor: string) {
  const conn = getConnector(input.provider);
  if (!conn) throw new PaymentsError("Unbekannter Zahlungsanbieter.");
  if (input.mode === "live" && !liveAllowed()) throw new PaymentsError("Live-Zahlungen sind auf diesem Server nicht freigeschaltet (PAYMENTS_MODE=live). Bitte zunächst im Testmodus verbinden.");
  const existing = await db.paymentProvider.findUnique({ where: { workspaceId_provider: { workspaceId, provider: conn.key } } });
  const old = openCredentials(existing?.credentials);
  // Leere Geheimnis-Felder = bisherigen Wert behalten
  const creds: Credentials = {};
  for (const f of conn.fields) {
    const v = (input.credentials[f.name] ?? "").trim();
    if (v) creds[f.name] = v.slice(0, 4000);
    else if (old[f.name]) creds[f.name] = old[f.name];
    if (f.required && !creds[f.name]) throw new PaymentsError(`${f.label} fehlt.`);
  }
  const detected = conn.detectMode(creds);
  if (detected && detected !== input.mode) throw new PaymentsError(`Der Schlüssel ist ein ${detected === "live" ? "Live" : "Test"}-Schlüssel, gewählt ist aber „${input.mode === "live" ? "Live" : "Test"}“.`);
  const known = new Set(conn.knownMethods.map((m) => m.id));
  const methods = input.methods.filter((m) => known.has(m));
  const row = await db.$transaction(async (tx) => {
    if (input.isDefault) await tx.paymentProvider.updateMany({ where: { workspaceId, provider: { not: conn.key } }, data: { isDefault: false } });
    const data = { mode: input.mode, credentials: sealCredentials(creds), methods, active: input.active, isDefault: input.isDefault, status: "unchecked", lastError: null };
    return existing
      ? tx.paymentProvider.update({ where: { id: existing.id }, data })
      : tx.paymentProvider.create({ data: { ...data, workspaceId, provider: conn.key } });
  });
  // Erster Anbieter wird automatisch Standard
  if (!input.isDefault && !(await db.paymentProvider.count({ where: { workspaceId, isDefault: true } }))) {
    await db.paymentProvider.update({ where: { id: row.id }, data: { isDefault: true } });
  }
  await audit({ workspaceId, actor, action: "payments.provider_saved", target: row.id, detail: { provider: conn.key, mode: input.mode, methods } });
  return row.id;
}

async function loadProviderRow(workspaceId: string, provider: string) {
  const row = await db.paymentProvider.findFirst({ where: { workspaceId, provider } });
  if (!row) throw new PaymentsError("Anbieter ist nicht verbunden.");
  const conn = getConnector(row.provider);
  if (!conn) throw new PaymentsError("Unbekannter Zahlungsanbieter.");
  return { row, conn, creds: openCredentials(row.credentials), mode: row.mode as Mode };
}

export async function testProvider(workspaceId: string, provider: string, actor: string) {
  const { row, conn, creds, mode } = await loadProviderRow(workspaceId, provider);
  try {
    const msg = await conn.test(creds, mode);
    await db.paymentProvider.update({ where: { id: row.id }, data: { status: "ok", lastError: null } });
    await audit({ workspaceId, actor, action: "payments.provider_tested", target: row.id, detail: { ok: true } });
    return msg;
  } catch (e) {
    const msg = errMessage(e);
    await db.paymentProvider.update({ where: { id: row.id }, data: { status: "error", lastError: msg.slice(0, 500) } });
    throw new PaymentsError(msg);
  }
}

/** Webhook beim Anbieter einrichten (Revolut liefert dabei das Signatur-Geheimnis). */
export async function registerProviderWebhook(workspaceId: string, provider: string, actor: string) {
  const { row, conn, creds, mode } = await loadProviderRow(workspaceId, provider);
  if (!conn.registerWebhook) return "Für diesen Anbieter ist keine Einrichtung nötig – die Webhook-Adresse wird je Zahlung mitgegeben.";
  const url = webhookUrlFor(row.provider, row.id);
  if (!/^https:\/\//.test(url)) throw new PaymentsError(`Die Webhook-Adresse ${url} ist nicht öffentlich per HTTPS erreichbar (PAYMENTS_PUBLIC_URL setzen).`);
  const r = await conn.registerWebhook(creds, mode, url);
  if (r.signingSecret) await db.paymentProvider.update({ where: { id: row.id }, data: { credentials: sealCredentials({ ...creds, webhookSecret: r.signingSecret }) } });
  await audit({ workspaceId, actor, action: "payments.webhook_registered", target: row.id, detail: { provider, webhookId: r.id } });
  return `Webhook eingerichtet (${r.id})${r.signingSecret ? ", Signatur-Geheimnis übernommen" : ""}.`;
}

// ---------- Rechnung: offener Betrag ----------

async function paidSoFar(tx: Tx, workspaceId: string, invoiceId: string) {
  const [payments, bank] = await Promise.all([
    tx.payment.findMany({ where: { workspaceId, invoiceId }, select: { status: true, amountCents: true, refundedCents: true } }),
    tx.bankTransaction.findMany({ where: { workspaceId, matchedInvoiceId: invoiceId, status: "matched" }, select: { amountCents: true } }),
  ]);
  return onlineNetCents(payments) + bankNetCents(bank);
}

export async function invoiceOpenCents(workspaceId: string, invoiceId: string, tx: Tx = db) {
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, workspaceId }, select: { grossCents: true, status: true } });
  if (!inv) return 0;
  if (inv.status === "PAID" || inv.status === "CANCELLED") return 0;
  return Math.max(0, inv.grossCents - (await paidSoFar(tx, workspaceId, invoiceId)));
}

/**
 * Rechnungsstatus nach einer Zahlungs- oder Abgleich-Änderung fortschreiben.
 * `paidBefore` = Summe vor der Änderung (gleiche Transaktion). Liefert die ausgelöste Folge.
 */
export async function applyInvoiceEffects(
  tx: Tx,
  workspaceId: string,
  invoiceId: string,
  paidBefore: number,
  source: { kind: "online" | "bank"; provider?: string; method?: string | null; paymentId?: string; bankTransactionId?: string; actor: string },
) {
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, workspaceId } });
  if (!inv) return "none" as const;
  const paidAfter = await paidSoFar(tx, workspaceId, invoiceId);
  const t = invoiceTransition(inv.status, inv.grossCents, paidBefore, paidAfter);
  const via = source.kind === "online" ? `online (${source.provider ?? "?"}${source.method ? `, ${source.method}` : ""})` : "per Überweisung (Kontoabgleich)";
  if (t === "paid") {
    const r = await tx.invoice.updateMany({ where: { id: inv.id, status: { notIn: ["PAID", "CANCELLED", "DRAFT"] } }, data: { status: "PAID" } });
    if (r.count) {
      await emitInvoicePaid(tx, inv, { via: source.kind, provider: source.provider, method: source.method, paymentId: source.paymentId, bankTransactionId: source.bankTransactionId });
      if (inv.contactId) await tx.activity.create({ data: { workspaceId, contactId: inv.contactId, type: "SYSTEM", body: `Rechnung ${inv.number} vollständig bezahlt ${via}.`, meta: { invoiceId: inv.id, paymentId: source.paymentId, bankTransactionId: source.bankTransactionId } } });
    }
  } else if (t === "partial" && inv.contactId) {
    await tx.activity.create({ data: { workspaceId, contactId: inv.contactId, type: "SYSTEM", body: `Teilzahlung zu ${inv.number}: ${formatCents(paidAfter - paidBefore)} ${via}, offen ${formatCents(Math.max(0, inv.grossCents - paidAfter))}.`, meta: { invoiceId: inv.id, paymentId: source.paymentId, bankTransactionId: source.bankTransactionId } } });
  } else if (t === "reopened") {
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "SENT" } });
    if (inv.contactId) await tx.activity.create({ data: { workspaceId, contactId: inv.contactId, type: "SYSTEM", body: `Erstattung zu ${inv.number}: Rechnung wieder offen (${formatCents(Math.max(0, inv.grossCents - paidAfter))}).`, meta: { invoiceId: inv.id, paymentId: source.paymentId } } });
  }
  return t;
}

// ---------- Bezahllink ----------

async function defaultProvider(workspaceId: string, provider?: string) {
  const where = { workspaceId, active: true, ...(provider ? { provider } : {}) };
  return (await db.paymentProvider.findFirst({ where: { ...where, isDefault: true } })) ?? (await db.paymentProvider.findFirst({ where, orderBy: { createdAt: "asc" } }));
}

/** Gibt es für den Sub-Account einen aktiven Zahlungsanbieter? (für Anzeige des Bezahl-Buttons) */
export async function paymentsEnabled(workspaceId: string) {
  return (await db.paymentProvider.count({ where: { workspaceId, active: true } })) > 0;
}

const REUSE_MAX_AGE_MS = 7 * 24 * 3600_000;

/**
 * Bezahllink für eine Rechnung: vorhandene offene Zahlung (gleicher Betrag, nicht abgelaufen) wiederverwenden,
 * sonst neue Zahlung beim Anbieter anlegen. Gesperrt je Rechnung (Advisory Lock) gegen Doppelanlage.
 */
export async function ensurePaymentLink(workspaceId: string, invoiceId: string, opts: { provider?: string; actor?: string } = {}) {
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, workspaceId }, include: { contact: { select: { email: true } } } });
  if (!inv || inv.kind !== "INVOICE") throw new PaymentsError("Rechnung nicht gefunden.");
  if (inv.status === "PAID") throw new PaymentsError("Diese Rechnung ist bereits bezahlt.");
  if (inv.status === "CANCELLED") throw new PaymentsError("Diese Rechnung wurde storniert.");
  if (inv.status === "DRAFT") throw new PaymentsError("Die Rechnung ist noch ein Entwurf.");
  if (inv.currency !== "EUR") throw new PaymentsError("Online-Zahlung ist nur für Rechnungen in Euro möglich.");
  const prov = await defaultProvider(workspaceId, opts.provider);
  if (!prov) throw new PaymentsError("Für diesen Sub-Account ist kein Zahlungsanbieter verbunden.");
  const conn = getConnector(prov.provider);
  if (!conn) throw new PaymentsError("Unbekannter Zahlungsanbieter.");
  if (prov.mode === "live" && !liveAllowed()) throw new PaymentsError("Live-Zahlungen sind auf diesem Server nicht freigeschaltet.");

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-link:${invoiceId}`}))`;
      const open = Math.max(0, inv.grossCents - (await paidSoFar(tx, workspaceId, invoiceId)));
      if (open <= 0) throw new PaymentsError("Für diese Rechnung ist nichts mehr offen.");
      const now = Date.now();
      const reusable = await tx.payment.findFirst({
        where: { workspaceId, invoiceId, providerId: prov.id, status: { in: [...OPEN_STATUSES] }, amountCents: open, checkoutUrl: { not: null }, createdAt: { gt: new Date(now - REUSE_MAX_AGE_MS) } },
        orderBy: { createdAt: "desc" },
      });
      if (reusable && (!reusable.expiresAt || reusable.expiresAt.getTime() > now + 5 * 60_000)) return { paymentId: reusable.id, checkoutUrl: reusable.checkoutUrl!, reused: true };

      const attempt = await tx.payment.count({ where: { invoiceId, providerId: prov.id } });
      const ref = `${invoiceId}-${attempt + 1}`;
      const created = await conn.create(openCredentials(prov.credentials), prov.mode as Mode, {
        amountCents: open,
        currency: inv.currency,
        description: `Rechnung ${inv.number}`,
        returnUrl: `${payPageUrl(invoiceId)}?r=${encodeURIComponent(ref)}`,
        webhookUrl: webhookUrlFor(prov.provider, prov.id),
        idempotencyKey: `pay-${ref}-${open}`,
        metadata: { workspaceId, invoiceId, paymentRef: ref },
        methods: prov.methods,
        customerEmail: inv.buyerEmail ?? inv.contact?.email ?? null,
      });
      if (!created.checkoutUrl) throw new PaymentsError("Der Anbieter hat keinen Bezahllink geliefert.");
      const p = await tx.payment.upsert({
        where: { providerId_externalId: { providerId: prov.id, externalId: created.externalId } },
        create: {
          workspaceId,
          providerId: prov.id,
          invoiceId,
          subscriptionId: inv.subscriptionId,
          externalId: created.externalId,
          method: created.method,
          amountCents: created.amountCents || open,
          currency: created.currency,
          status: created.status,
          checkoutUrl: created.checkoutUrl,
          expiresAt: created.expiresAt,
        },
        update: {},
      });
      await audit({ workspaceId, actor: opts.actor ?? "system", action: "payments.link_created", target: p.id, detail: { invoiceId, provider: prov.provider, amountCents: open } });
      return { paymentId: p.id, checkoutUrl: created.checkoutUrl, reused: false };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

// ---------- Abgleich mit dem Anbieter ----------

/** Zustand beim Anbieter abfragen und genau einmal anwenden. Idempotent. */
export async function syncPayment(paymentId: string, actor = "system") {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { providerRef: true } });
  if (!p) return null;
  const conn = getConnector(p.providerRef.provider);
  if (!conn) return null;
  const remote = await conn.get(openCredentials(p.providerRef.credentials), p.providerRef.mode as Mode, p.externalId);
  return applyRemote(p, remote, p.providerRef.provider, actor);
}

type PaymentRow = { id: string; workspaceId: string; invoiceId: string | null; status: string; refundedCents: number; method: string | null; amountCents: number };

async function applyRemote(p: PaymentRow, remote: ProviderPayment, provider: string, actor: string) {
  const sameState = remote.status === p.status && remote.refundedCents === p.refundedCents && (remote.method ?? p.method) === p.method;
  if (sameState) return { changed: false, status: p.status as PaymentStatus };
  const result = await db.$transaction(async (tx) => {
    const paidBefore = p.invoiceId ? await paidSoFar(tx, p.workspaceId, p.invoiceId) : 0;
    // Bedingtes Update: nur wenn seit dem Lesen niemand anderes den Zustand geändert hat
    const r = await tx.payment.updateMany({
      where: { id: p.id, status: p.status, refundedCents: p.refundedCents },
      data: {
        status: remote.status,
        refundedCents: remote.refundedCents,
        method: remote.method ?? p.method,
        paidAt: remote.paidAt ?? undefined,
        expiresAt: remote.expiresAt ?? undefined,
        ...(remote.checkoutUrl ? { checkoutUrl: remote.checkoutUrl } : {}),
      },
    });
    if (!r.count) return { changed: false, transition: "none" as const };
    const transition = p.invoiceId ? await applyInvoiceEffects(tx, p.workspaceId, p.invoiceId, paidBefore, { kind: "online", provider, method: remote.method ?? p.method, paymentId: p.id, actor }) : ("none" as const);
    return { changed: true, transition };
  });
  if (result.changed) {
    await audit({ workspaceId: p.workspaceId, actor, action: "payments.status_changed", target: p.id, detail: { from: p.status, to: remote.status, refundedCents: remote.refundedCents, invoice: result.transition } });
  }
  return { changed: result.changed, status: remote.status };
}

// ---------- Webhooks ----------

export type WebhookOutcome = { status: number; body: string };

/** Öffentlicher Eingang: Signatur prüfen, IDs als Job ablegen (Antwort schnell, Verarbeitung im Worker). */
export async function handleWebhookRequest(provider: string, providerRowId: string, headers: Headers, rawBody: string, ip: string): Promise<WebhookOutcome> {
  if (!(await rateLimitAsync(`paywh:${ip}`, 300, 60_000))) return { status: 429, body: "too many requests" };
  if (!isProviderKey(provider) || !/^[a-z0-9]{10,40}$/.test(providerRowId)) return { status: 404, body: "not found" };
  if (Buffer.byteLength(rawBody, "utf8") > WEBHOOK_MAX_BYTES) return { status: 413, body: "too large" };
  const row = await db.paymentProvider.findFirst({ where: { id: providerRowId, provider } });
  if (!row) return { status: 404, body: "not found" };
  const conn = getConnector(provider)!;
  const check = conn.checkWebhook(openCredentials(row.credentials), { headers, rawBody });
  if (!check.ok) {
    log.warn("payments webhook rejected", { provider, reason: check.reason });
    return { status: check.status, body: check.reason };
  }
  for (const externalId of check.externalIds.slice(0, 10)) {
    const payload = { providerId: row.id, externalId };
    const queued = await db.job.findFirst({ where: { type: "payments.webhook", status: "queued", payload: { equals: payload } }, select: { id: true } });
    if (!queued) await enqueue("payments.webhook", payload);
  }
  return { status: 200, body: "ok" };
}

/** Job payments.webhook: unbekannte IDs (nicht von uns angelegt) werden ignoriert. */
export async function processWebhookJob(payload: Record<string, unknown>) {
  const providerId = String(payload.providerId ?? "");
  const externalId = String(payload.externalId ?? "");
  const p = await db.payment.findUnique({ where: { providerId_externalId: { providerId, externalId } }, select: { id: true } });
  if (!p) {
    log.info("payments webhook for unknown payment ignored", { providerId });
    return;
  }
  await syncPayment(p.id, "system:webhook");
}

/** Fallback ohne Webhook (z. B. lokal): offene Zahlungen der letzten 3 Tage abfragen. */
export async function pollOpenPayments(limit = 200) {
  const rows = await db.payment.findMany({
    where: { status: { in: [...OPEN_STATUSES] }, createdAt: { gt: new Date(Date.now() - 3 * 24 * 3600_000) } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  let changed = 0;
  for (const r of rows) {
    try {
      if ((await syncPayment(r.id, "system:poll"))?.changed) changed++;
    } catch (e) {
      log.warn("payments poll failed", { paymentId: r.id, error: errMessage(e) });
    }
  }
  return { checked: rows.length, changed };
}

// ---------- Erstattung ----------

export async function refundPayment(workspaceId: string, paymentId: string, amountCents: number, actor: string) {
  const p = await db.payment.findFirst({ where: { id: paymentId, workspaceId }, include: { providerRef: true } });
  if (!p) throw new PaymentsError("Zahlung nicht gefunden.");
  if (!["paid", "partially_refunded"].includes(p.status)) throw new PaymentsError("Nur bezahlte Zahlungen können erstattet werden.");
  const max = p.amountCents - p.refundedCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > max) throw new PaymentsError(`Betrag muss zwischen 0,01 € und ${formatCents(max)} liegen.`);
  if (p.providerRef.mode === "live" && !liveAllowed()) throw new PaymentsError("Live-Zahlungen sind auf diesem Server nicht freigeschaltet.");
  const conn = getConnector(p.providerRef.provider);
  if (!conn) throw new PaymentsError("Unbekannter Zahlungsanbieter.");
  const inv = p.invoiceId ? await db.invoice.findFirst({ where: { id: p.invoiceId, workspaceId }, select: { number: true } }) : null;
  const r = await conn.refund(openCredentials(p.providerRef.credentials), p.providerRef.mode as Mode, p.externalId, amountCents, p.currency, `refund-${p.id}-${p.refundedCents}-${amountCents}`, `Erstattung ${inv?.number ?? ""}`.trim());
  await audit({ workspaceId, actor, action: "payments.refund_requested", target: p.id, detail: { amountCents, refundId: r.refundId, status: r.status } });
  try {
    await syncPayment(p.id, actor);
  } catch (e) {
    log.warn("payments refund sync failed", { paymentId: p.id, error: errMessage(e) });
  }
  return r;
}

export function describeStatus(s: string) {
  return STATUS_LABEL[s as PaymentStatus] ?? s;
}

export { PaymentError };
