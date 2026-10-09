import type { JobHandler } from "@/lib/jobs";
import { enqueue } from "@/lib/jobs";
import { db } from "@/lib/db";
import { writeSnapshots } from "@/lib/usage";

// Täglicher Nutzungs-Snapshot je Sub-Account (Grundlage für Kostenverlauf und Paketpreise).

function nextRun() {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + (next.getUTCHours() >= 2 ? 1 : 0));
  next.setUTCHours(2, 30, 0, 0);
  return next;
}

/** Nächsten Lauf einplanen, falls noch keiner wartet (idempotent). */
export async function ensureUsageScheduled() {
  const pending = await db.job.count({ where: { type: "usage.snapshot", status: "queued" } });
  if (pending === 0) await enqueue("usage.snapshot", {}, { runAt: nextRun() });
}

export const handlers: Record<string, JobHandler> = {
  "usage.snapshot": async () => {
    const n = await writeSnapshots();
    console.log(`usage.snapshot: ${n} Sub-Account(s) gemessen`);
    // Der laufende Job zählt nicht als „queued“ → Folgetag einreihen
    await ensureUsageScheduled();
  },
};

export const onWorkerStart = ensureUsageScheduled;
