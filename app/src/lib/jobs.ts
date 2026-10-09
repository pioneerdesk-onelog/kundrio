import { Prisma } from "@prisma/client";
import { db } from "./db";

// DB-gestützte Job-Warteschlange. Abgearbeitet von `npm run worker` (scripts/worker.ts).
// Handler liegen in src/jobs/<name>.ts und exportieren `handlers: Record<string, JobHandler>`.

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export async function enqueue(type: string, payload: Record<string, unknown>, opts: { runAt?: Date } = {}) {
  return db.job.create({ data: { type, payload: payload as Prisma.InputJsonValue, runAt: opts.runAt ?? new Date() } });
}

/** Holt den nächsten fälligen Job exklusiv (mehrere Worker möglich). */
export async function claimNextJob() {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Job" SET status = 'running', "lockedAt" = now(), "startedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE (status = 'queued' AND "runAt" <= now())
         OR (status = 'running' AND "lockedAt" < now() - interval '10 minutes')
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  if (rows.length === 0) return null;
  return db.job.findUnique({ where: { id: rows[0].id } });
}

async function elapsedMs(id: string) {
  const j = await db.job.findUnique({ where: { id }, select: { startedAt: true } });
  return j?.startedAt ? Date.now() - j.startedAt.getTime() : null;
}

export async function finishJob(id: string) {
  const durationMs = await elapsedMs(id);
  await db.job.update({ where: { id }, data: { status: "done", lockedAt: null, lastError: null, durationMs } });
}

export async function failJob(id: string, attempts: number, err: unknown, maxAttempts = 5) {
  const msg = String(err instanceof Error ? err.message : err).slice(0, 1000);
  const retry = attempts < maxAttempts;
  const durationMs = await elapsedMs(id);
  await db.job.update({
    where: { id },
    data: {
      durationMs,
      status: retry ? "queued" : "failed",
      lockedAt: null,
      lastError: msg,
      // Exponentielles Warten: 30 s, 2 min, 8 min, 32 min
      runAt: retry ? new Date(Date.now() + 30_000 * 4 ** (attempts - 1)) : undefined,
    },
  });
}
