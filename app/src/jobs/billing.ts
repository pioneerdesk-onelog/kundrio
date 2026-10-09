import type { JobHandler } from "@/lib/jobs";
import { enqueue } from "@/lib/jobs";
import { db } from "@/lib/db";
import { runBilling, runDunning } from "@/lib/billing/service";
import { errMessage, log } from "@/lib/log";

// Täglich: Abo-Rechnungen erzeugen (billing.run, 03:00 UTC) und Mahnstufen prüfen (billing.dunning, 03:30 UTC).

function nextRun(hour: number, minute: number) {
  const next = new Date();
  const passed = next.getUTCHours() > hour || (next.getUTCHours() === hour && next.getUTCMinutes() >= minute);
  next.setUTCDate(next.getUTCDate() + (passed ? 1 : 0));
  next.setUTCHours(hour, minute, 0, 0);
  return next;
}

async function ensure(type: string, hour: number, minute: number) {
  const pending = await db.job.count({ where: { type, status: "queued" } });
  if (pending === 0) await enqueue(type, {}, { runAt: nextRun(hour, minute) });
}

export async function ensureBillingScheduled() {
  await ensure("billing.run", 3, 0);
  await ensure("billing.dunning", 3, 30);
}

async function forEachWorkspace(where: object, fn: (wsId: string) => Promise<unknown>, label: string) {
  const ids = await db.workspace.findMany({ where, select: { id: true } });
  for (const { id } of ids) {
    try {
      const r = await fn(id);
      log.info(label, { workspaceId: id, result: r as Record<string, unknown> });
    } catch (e) {
      log.warn(`${label} failed`, { workspaceId: id, error: errMessage(e) });
    }
  }
}

export const handlers: Record<string, JobHandler> = {
  "billing.run": async () => {
    await forEachWorkspace({ subscriptions: { some: {} } }, (id) => runBilling(id), "billing.run");
    await ensureBillingScheduled();
  },
  "billing.dunning": async () => {
    await forEachWorkspace({ invoices: { some: { status: "SENT" } } }, (id) => runDunning(id), "billing.dunning");
    await ensureBillingScheduled();
  },
};

export const onWorkerStart = ensureBillingScheduled;
