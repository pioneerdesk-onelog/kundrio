import type { JobHandler } from "@/lib/jobs";
import { enqueue } from "@/lib/jobs";
import { db } from "@/lib/db";
import { monitorDomains, runVerification } from "@/lib/domains/service";

// Eigene Domains: Prüfung nach Einrichtung (mit Backoff bis 48 h) und tägliche Überwachung (05:10 UTC).

function nextMonitor() {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + (next.getUTCHours() >= 5 ? 1 : 0));
  next.setUTCHours(5, 10, 0, 0);
  return next;
}

export async function ensureDomainMonitorScheduled() {
  const pending = await db.job.count({ where: { type: "domains.monitor", status: "queued" } });
  if (pending === 0) await enqueue("domains.monitor", {}, { runAt: nextMonitor() });
}

export const handlers: Record<string, JobHandler> = {
  "domains.verify": async (p) => {
    await runVerification({ domainId: String(p.domainId), attempt: Number(p.attempt ?? 0), startedAt: String(p.startedAt ?? new Date().toISOString()) });
  },
  "domains.monitor": async () => {
    await monitorDomains();
    await ensureDomainMonitorScheduled();
  },
};

export const onWorkerStart = ensureDomainMonitorScheduled;
