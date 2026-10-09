import type { JobHandler } from "@/lib/jobs";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { processTransactional } from "@/lib/mail-transactional";
import { deliverWebhook } from "@/lib/webhook";

/** Anhänge und Empfängerdaten nicht dauerhaft in der Job-Tabelle lassen. */
async function scrubOldMailJobs() {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  await db.job.updateMany({
    where: { type: { in: ["mail.transactional", "webhook.deliver"] }, status: { in: ["done", "failed"] }, updatedAt: { lt: cutoff } },
    data: { payload: { scrubbed: true } },
  });
}

async function ensureCleanupScheduled() {
  const pending = await db.job.count({ where: { type: "mail.cleanup", status: { in: ["queued", "running"] } } });
  if (pending === 0) await enqueue("mail.cleanup", {}, { runAt: new Date(Date.now() + 6 * 3600 * 1000) });
}

export const handlers: Record<string, JobHandler> = {
  "mail.transactional": async (p) => {
    await processTransactional(p as Parameters<typeof processTransactional>[0]);
  },
  "webhook.deliver": async (p) => {
    await deliverWebhook(String(p.webhookId), p.body);
  },
  "mail.cleanup": async () => {
    await scrubOldMailJobs();
    await enqueue("mail.cleanup", {}, { runAt: new Date(Date.now() + 6 * 3600 * 1000) });
  },
};

export const onWorkerStart = ensureCleanupScheduled;
