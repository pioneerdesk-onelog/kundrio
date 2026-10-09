import type { JobHandler } from "@/lib/jobs";
import { db } from "@/lib/db";
import { runAutoChecks } from "@/lib/compliance-checks";
import { AUTOCHECK_INTERVAL_MS, ensureAutocheckSchedules } from "@/lib/compliance-schedule";
import { enqueue } from "@/lib/jobs";

export const handlers: Record<string, JobHandler> = {
  "compliance.autocheck": async (p) => {
    const workspaceId = String(p.workspaceId);
    const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!ws) return; // Sub-Account gelöscht → Kette endet
    try {
      await runAutoChecks(workspaceId);
    } finally {
      // Nächste Prüfung in einer Woche – nur, wenn keine andere wartet (idempotent, auch bei Retries)
      const other = await db.job.findFirst({
        where: { type: "compliance.autocheck", status: "queued", payload: { path: ["workspaceId"], equals: workspaceId } },
        select: { id: true },
      });
      if (!other) await enqueue("compliance.autocheck", { workspaceId }, { runAt: new Date(Date.now() + AUTOCHECK_INTERVAL_MS) });
    }
  },
  // Einmal-Job: stellt sicher, dass jeder Sub-Account mit Pflichten-Katalog eine geplante Prüfung hat
  "compliance.schedule": async () => {
    await ensureAutocheckSchedules();
  },
};

// Beim Start des Workers fehlende Wochenprüfungen einplanen
export { ensureAutocheckSchedules as onWorkerStart } from "@/lib/compliance-schedule";
