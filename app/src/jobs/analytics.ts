import type { JobHandler } from "@/lib/jobs";
import { enqueue } from "@/lib/jobs";
import { db } from "@/lib/db";
import { importLogText } from "@/lib/analytics/importlog";

const RETENTION_MONTHS = 13;

/** Nächsten Lauf um 03:00 UTC einplanen, falls noch keiner wartet (idempotent). */
export async function ensureRetentionScheduled() {
  const pending = await db.job.count({ where: { type: "analytics.retention", status: { in: ["queued", "running"] } } });
  if (pending > 0) return;
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + (next.getUTCHours() >= 3 ? 1 : 0));
  next.setUTCHours(3, 0, 0, 0);
  await enqueue("analytics.retention", {}, { runAt: next });
}

export const handlers: Record<string, JobHandler> = {
  "analytics.import": async (p) => {
    const r = await importLogText(String(p.workspaceId), String(p.text ?? ""), (p.ownHost as string | null) ?? null);
    console.log(`analytics.import: ${r.imported} importiert, ${r.duplicates} doppelt, ${r.ignored} ignoriert, ${r.invalid} ungültig`);
  },

  "analytics.retention": async () => {
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
    const events = await db.analyticsEvent.deleteMany({ where: { ts: { lt: cutoff } } });
    // Salze älter als gestern löschen → alte Besucher-Hashes lassen sich nicht mehr nachrechnen
    const yesterday = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const salts = await db.analyticsSalt.deleteMany({ where: { date: { lt: yesterday } } });
    console.log(`analytics.retention: ${events.count} Ereignisse, ${salts.count} Salze gelöscht`);
    // Der aktuelle Job ist noch „running“ → direkt den nächsten Lauf einreihen
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(3, 0, 0, 0);
    const queued = await db.job.count({ where: { type: "analytics.retention", status: "queued" } });
    if (queued === 0) await enqueue("analytics.retention", {}, { runAt: next });
  },
};

// Beim Start des Workers sicherstellen, dass die Aufbewahrungs-Bereinigung eingeplant ist
export const onWorkerStart = ensureRetentionScheduled;
