// Hintergrund-Worker: arbeitet die Job-Tabelle ab.  npm run worker
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { JobHandler } from "../src/lib/jobs";
import { claimNextJob, failJob, finishJob } from "../src/lib/jobs";
import { runLoop } from "../src/lib/worker-loop";
import { db } from "../src/lib/db";
import { assertProductionEnv } from "../src/lib/env";
import { cleanupRateLimits } from "../src/lib/ratelimit";
import { errMessage, log } from "../src/lib/log";
import { hostname } from "node:os";

async function loadHandlers() {
  const dir = path.join(__dirname, "../src/jobs");
  const all: Record<string, JobHandler> = {};
  const startHooks: (() => Promise<unknown>)[] = [];
  const failHooks: Record<string, (jobId: string, payload: Record<string, unknown>) => Promise<unknown>> = {};
  for (const f of await readdir(dir)) {
    if (!/\.(ts|js)$/.test(f) || f.endsWith(".test.ts")) continue;
    const mod = (await import(path.join(dir, f))) as {
      handlers?: Record<string, JobHandler>;
      onWorkerStart?: () => Promise<unknown>;
      onJobFailed?: (jobId: string, payload: Record<string, unknown>) => Promise<unknown>;
    };
    if (mod.onWorkerStart) startHooks.push(mod.onWorkerStart);
    // Aufräumen nach endgültigem Scheitern (z. B. Geheimnisse aus der Nutzlast entfernen)
    if (mod.onJobFailed) for (const type of Object.keys(mod.handlers ?? {})) failHooks[type] = mod.onJobFailed;
    for (const [type, h] of Object.entries(mod.handlers ?? {})) {
      if (all[type]) throw new Error(`Job-Typ doppelt registriert: ${type}`);
      all[type] = h;
    }
  }
  return { all, startHooks, failHooks };
}

let stopping = false;
function requestStop(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("worker stopping", { signal });
  // Spätestens nach 25 s beenden (Kubernetes terminationGracePeriod 30 s), laufender Job wird per Lock später neu aufgenommen
  setTimeout(() => {
    log.warn("worker forced exit after timeout");
    process.exit(0);
  }, 25_000).unref();
}
process.on("SIGINT", () => requestStop("SIGINT"));
process.on("SIGTERM", () => requestStop("SIGTERM"));

// Herzschlag für /api/health: zeigt, ob mindestens ein Worker lebt
async function heartbeat(startedAt: Date) {
  const value = { at: new Date().toISOString(), startedAt: startedAt.toISOString(), host: hostname().slice(0, 64), pid: process.pid };
  await db.appSetting
    .upsert({ where: { key: "worker:heartbeat" }, create: { key: "worker:heartbeat", value }, update: { value } })
    .catch((e) => log.warn("heartbeat failed", { error: errMessage(e) }));
}

async function main() {
  assertProductionEnv();
  const startedAt = new Date();
  await heartbeat(startedAt);
  const hb = setInterval(() => void heartbeat(startedAt), 30_000);
  const rl = setInterval(() => {
    cleanupRateLimits()
      .then((n) => n && log.debug("rate-limit cleanup", { deleted: n }))
      .catch((e) => log.warn("rate-limit cleanup failed", { error: errMessage(e) }));
  }, 3600_000);
  const { all: handlers, startHooks, failHooks } = await loadHandlers();
  // Wiederkehrende Jobs einplanen (z. B. Analytics-Aufbewahrung); Fehler blockieren den Worker nicht
  for (const hook of startHooks) await hook().catch((e) => log.error("start hook failed", { error: errMessage(e) }));
  log.info("worker ready", { jobTypes: Object.keys(handlers).sort() });
  // Fehlertolerant (LR-7): DB-Verbindungsabbruch o. Ä. in einer Runde → protokollieren, 2 s warten, weiter
  await runLoop(async () => {
    const job = await claimNextJob();
    if (!job) return "idle";
    const known = Object.hasOwn(handlers, job.type);
    const handler = handlers[job.type];
    try {
      if (!known) throw new Error(`Kein Handler für Job-Typ ${job.type}`);
      await handler(job.payload as Record<string, unknown>);
      await finishJob(job.id);
      log.info("job done", { type: job.type, jobId: job.id });
    } catch (err) {
      log.error("job failed", { type: job.type, jobId: job.id, attempt: job.attempts, error: errMessage(err) });
      const maxAttempts = known ? 5 : 1;
      await failJob(job.id, job.attempts, err, maxAttempts);
      if (job.attempts >= maxAttempts && failHooks[job.type]) {
        await failHooks[job.type](job.id, job.payload as Record<string, unknown>).catch((e) => log.error("fail hook failed", { type: job.type, error: errMessage(e) }));
      }
    }
    return "busy";
  }, { shouldStop: () => stopping, onError: (e) => log.error("worker loop error", { error: errMessage(e) }) });
  clearInterval(hb);
  clearInterval(rl);
  await db.$disconnect();
  log.info("worker stopped");
  // Andere Intervalle (z. B. Ereignis-Verteiler) nicht abwarten
  process.exit(0);
}

main().catch((e) => {
  log.error("worker crashed", { error: errMessage(e) });
  process.exit(1);
});
