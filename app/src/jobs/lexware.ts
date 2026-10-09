import type { JobHandler } from "@/lib/jobs";
import { enqueue } from "@/lib/jobs";
import { db } from "@/lib/db";
import { lexwareConfigured } from "@/lib/lexware/config";
import { pullStatuses } from "@/lib/lexware/sync";

// Lexware-Abgleich: täglich (alle aktivierten Sub-Accounts) oder manuell für einen Sub-Account.

function nextRun() {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + (next.getUTCHours() >= 4 ? 1 : 0));
  next.setUTCHours(4, 0, 0, 0);
  return next;
}

/** Täglichen Lauf einplanen, falls noch keiner wartet (idempotent). */
export async function ensureLexwareScheduled() {
  const pending = await db.job.count({ where: { type: "lexware.sync", status: "queued", payload: { path: ["daily"], equals: true } } });
  if (pending === 0) await enqueue("lexware.sync", { daily: true }, { runAt: nextRun() });
}

export const handlers: Record<string, JobHandler> = {
  "lexware.sync": async (p) => {
    try {
      if (!lexwareConfigured()) return; // ohne Schlüssel nichts tun (kein Fehler, kein Retry)
      const ids = p.workspaceId
        ? [String(p.workspaceId)]
        : (await db.appSetting.findMany({ where: { key: { startsWith: "lexware:" } } }))
            .filter((s) => (s.value as { enabled?: boolean })?.enabled)
            .map((s) => s.key.slice("lexware:".length));
      for (const ws of ids) await pullStatuses(ws, p.actor ? String(p.actor) : "system");
    } finally {
      if (p.daily) await ensureLexwareScheduled();
    }
  },
};

export const onWorkerStart = ensureLexwareScheduled;
