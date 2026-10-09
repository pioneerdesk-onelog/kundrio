// Hintergrund-Monitor während der E2E-Suite: schreibt alle 2 s eine Zeile nach out/monitor.jsonl.
// Beenden mit SIGTERM/SIGINT. Liest nur – verändert keine Daten.
import { PrismaClient } from "@prisma/client";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

try { process.loadEnvFile(path.join(__dirname, "../.env")); } catch { /* optional */ }
const db = new PrismaClient();
const OUT = path.join(__dirname, "out/monitor.jsonl");
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
mkdirSync(path.dirname(OUT), { recursive: true });

const startedAt = new Date();
let stop = false;
process.on("SIGTERM", () => (stop = true));
process.on("SIGINT", () => (stop = true));

async function sample() {
  const since = startedAt;
  const [outboxOpen, outboxOldest, outboxFailed, jobsByStatus, stuckJobs, runs, approvals, mails, audits] = await Promise.all([
    db.crmEvent.count({ where: { processedAt: null } }),
    db.crmEvent.findFirst({ where: { processedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true, type: true } }),
    db.crmEvent.count({ where: { processedAt: null, attempts: { gte: 5 } } }),
    db.job.groupBy({ by: ["status"], where: { updatedAt: { gte: since } }, _count: true }),
    db.job.count({ where: { status: "running", lockedAt: { lt: new Date(Date.now() - 5 * 60_000) } } }),
    db.processRun.groupBy({ by: ["status"], where: { startedAt: { gte: since } }, _count: true }),
    db.approval.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true }),
    db.emailMessage.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true }),
    db.auditLog.count({ where: { createdAt: { gte: since } } }),
  ]);
  let health: unknown = null;
  try {
    const r = await fetch(`${BASE}/api/health?deep=1`, { signal: AbortSignal.timeout(3000) });
    health = { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    health = { error: String(e instanceof Error ? e.message : e) };
  }
  const g = (rows: { _count: number }[], key: string) => Object.fromEntries(rows.map((r) => [(r as Record<string, unknown>)[key] as string, r._count]));
  return {
    t: new Date().toISOString(),
    outbox: { open: outboxOpen, oldestAgeSec: outboxOldest ? Math.round((Date.now() - outboxOldest.createdAt.getTime()) / 1000) : 0, oldestType: outboxOldest?.type ?? null, failed: outboxFailed },
    jobs: { ...g(jobsByStatus, "status"), stuck: stuckJobs },
    runs: g(runs, "status"),
    approvals: g(approvals, "status"),
    mails: g(mails, "status"),
    audits,
    health,
  };
}

(async () => {
  while (!stop) {
    try {
      appendFileSync(OUT, JSON.stringify(await sample()) + "\n");
    } catch (e) {
      appendFileSync(OUT, JSON.stringify({ t: new Date().toISOString(), error: String(e) }) + "\n");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await db.$disconnect();
})();
