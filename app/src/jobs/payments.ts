import type { JobHandler } from "@/lib/jobs";
import { enqueue } from "@/lib/jobs";
import { db } from "@/lib/db";
import { pollOpenPayments, processWebhookJob } from "@/lib/payments/service";
import { syncBankAccount } from "@/lib/payments/reconcile/service";
import { errMessage, log } from "@/lib/log";

// payments.webhook: Zahlungsstatus beim Anbieter abfragen und anwenden (aus öffentlichem Webhook, idempotent).
// payments.poll:    alle 15 min offene Zahlungen abfragen (Fallback ohne erreichbaren Webhook, z. B. lokal).
// bank.sync:        täglich 05:00 UTC Revolut-Business-Umsätze holen und zuordnen.

async function ensure(type: string, runAt: Date) {
  const pending = await db.job.count({ where: { type, status: "queued" } });
  if (pending === 0) await enqueue(type, {}, { runAt });
}

function nextDaily(hour: number) {
  const d = new Date();
  if (d.getUTCHours() >= hour) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

export async function ensurePaymentsScheduled() {
  await ensure("payments.poll", new Date(Date.now() + 15 * 60_000));
  await ensure("bank.sync", nextDaily(5));
}

export const handlers: Record<string, JobHandler> = {
  "payments.webhook": async (payload) => {
    await processWebhookJob(payload);
  },
  "payments.poll": async () => {
    try {
      const r = await pollOpenPayments();
      if (r.checked) log.info("payments.poll", r);
    } finally {
      await ensurePaymentsScheduled();
    }
  },
  "bank.sync": async (payload) => {
    try {
      const where = payload.accountId ? { id: String(payload.accountId) } : { source: "revolut_business" };
      const accounts = await db.bankAccount.findMany({ where, select: { id: true, workspaceId: true } });
      for (const a of accounts) {
        try {
          const r = await syncBankAccount(a.id);
          log.info("bank.sync", { workspaceId: a.workspaceId, result: r });
        } catch (e) {
          log.warn("bank.sync failed", { workspaceId: a.workspaceId, error: errMessage(e) });
        }
      }
    } finally {
      if (!payload.accountId) await ensurePaymentsScheduled();
    }
  },
};

export const onWorkerStart = ensurePaymentsScheduled;
