import type { JobHandler } from "@/lib/jobs";
import { db } from "@/lib/db";
import { dispatchEvents, markRunFailed, runProcessStep, scheduleDaily } from "@/lib/process/engine";
import { drainEvents } from "@/lib/process/drain";
import "@/lib/approval-kinds";
import { errMessage, log } from "@/lib/log";

// Prozess-Engine im Worker:
//  • Verteiler läuft als Schleife im Worker-Prozess (alle 2 s, keine Job-Zeilen pro Durchlauf);
//    ein Takt verteilt weiter, solange volle Stapel kommen (höchstens 10 s), sonst wäre der Durchsatz
//    fest auf 100 Ereignisse/s gedeckelt (Belastungstest LR-1). Mehrere Worker sind sicher (SKIP LOCKED).
//  • process.step: einen Lauf ausführen (Wiederholung mit Backoff durch den Worker).
//  • process.daily: zeitbasierte Prozesse + Aufräumen, plant sich selbst für den nächsten Tag.

const DISPATCH_INTERVAL_MS = 2000;

function nextDailyRun(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 15));
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

async function ensureDaily() {
  const queued = await db.job.findFirst({ where: { type: "process.daily", status: { in: ["queued", "running"] } }, select: { id: true } });
  if (!queued) await db.job.create({ data: { type: "process.daily", payload: {}, runAt: nextDailyRun() } });
}

export const handlers: Record<string, JobHandler> = {
  "process.step": async (p) => {
    await runProcessStep(String(p.runId));
  },
  "process.daily": async () => {
    const started = await scheduleDaily();
    // Erledigte Prozess-Jobs nach 7 Tagen entfernen (Schrittprotokoll bleibt in ProcessStepLog)
    await db.job.deleteMany({ where: { type: { in: ["process.step", "process.daily"] }, status: "done", updatedAt: { lt: new Date(Date.now() - 7 * 864e5) } } });
    if (started) console.log(`Zeitbasierte Prozesse: ${started} Einschreibung(en)`);
    await db.job.create({ data: { type: "process.daily", payload: {}, runAt: nextDailyRun(new Date(Date.now() + 60_000)) } });
  },
};

let loop: NodeJS.Timeout | null = null;

export async function onWorkerStart() {
  await ensureDaily();
  if (loop) return;
  let busy = false;
  loop = setInterval(() => {
    if (busy) return;
    busy = true;
    drainEvents((limit) => dispatchEvents(limit), { batch: 200, budgetMs: 10_000 })
      .then((r) => {
        if (r.started || r.failed) console.log(`Ereignisse: ${r.processed} verarbeitet, ${r.started} Läufe gestartet, ${r.failed} Fehler`);
      })
      .catch((e) => log.error("dispatcher error", { error: errMessage(e) }))
      .finally(() => (busy = false));
  }, DISPATCH_INTERVAL_MS);
  loop.unref?.();
}

/** Endgültig gescheiterter Schritt-Job → Lauf als fehlgeschlagen markieren (Fehlertext aus dem Job). */
export async function onJobFailed(jobId: string, payload: Record<string, unknown>) {
  if (!payload.runId) return;
  const job = await db.job.findUnique({ where: { id: jobId }, select: { lastError: true } });
  await markRunFailed(String(payload.runId), job?.lastError ?? "Schritt endgültig fehlgeschlagen");
}
