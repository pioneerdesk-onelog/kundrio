import type { JobHandler } from "@/lib/jobs";
import { enqueue } from "@/lib/jobs";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { researchObject } from "@/lib/research/run";

// Presse-/Erwähnungs-Recherche: Einzelauftrag (Knopf „Jetzt recherchieren“) und wöchentliches Monitoring.

const MONITOR_PER_WORKSPACE = 25;

function nextMonday() {
  const d = new Date();
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  d.setUTCHours(5, 0, 0, 0);
  return d;
}

/** Wöchentlichen Monitoring-Lauf einplanen, falls keiner wartet (idempotent). */
export async function ensureMonitorScheduled() {
  const pending = await db.job.count({ where: { type: "research.monitor", status: "queued" } });
  if (pending === 0) await enqueue("research.monitor", {}, { runAt: nextMonday() });
}

export const handlers: Record<string, JobHandler> = {
  "research.run": async (p) => {
    const workspaceId = String(p.workspaceId);
    const objectType = p.objectType === "contact" ? "contact" : "company";
    const r = await researchObject(workspaceId, objectType, String(p.objectId), { notify: true });
    log.info("research.run", { workspaceId, objectType, found: r.found, created: r.created, relevant: r.relevant });
  },

  "research.monitor": async () => {
    const workspaces = await db.workspace.findMany({ where: { mentionMonitoring: true }, select: { id: true } });
    for (const ws of workspaces) {
      // Aktive Unternehmen: mit Zuständigen oder offenem Deal, zuletzt geänderte zuerst
      const companies = await db.company.findMany({
        where: { workspaceId: ws.id, OR: [{ ownerId: { not: null } }, { deals: { some: { stage: { kind: "OPEN" } } } }] },
        orderBy: { updatedAt: "desc" },
        take: MONITOR_PER_WORKSPACE,
        select: { id: true },
      });
      for (const c of companies) {
        try {
          await researchObject(ws.id, "company", c.id, { timespan: "2weeks", maxAnalyses: 5, notify: true });
        } catch (e) {
          log.warn("research.monitor: Unternehmen übersprungen", { workspaceId: ws.id, companyId: c.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    await ensureMonitorScheduled();
  },
};

export const onWorkerStart = ensureMonitorScheduled;
