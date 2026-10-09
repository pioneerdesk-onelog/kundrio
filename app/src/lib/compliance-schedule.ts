import { db } from "./db";
import { enqueue } from "./jobs";

// Wöchentliche automatische Pflichten-Prüfung je Sub-Account (Job `compliance.autocheck`).

export const AUTOCHECK_INTERVAL_MS = 7 * 24 * 3600 * 1000;

/** Reiht die Prüfung ein, falls für diesen Workspace noch keine wartet (idempotent). */
export async function scheduleAutocheck(workspaceId: string, runAt = new Date(Date.now() + AUTOCHECK_INTERVAL_MS)) {
  const pending = await db.job.findFirst({
    where: { type: "compliance.autocheck", status: { in: ["queued", "running"] }, payload: { path: ["workspaceId"], equals: workspaceId } },
    select: { id: true, status: true },
  });
  // Ein laufender Job plant sich am Ende selbst neu ein; ein wartender genügt
  if (pending) return false;
  await enqueue("compliance.autocheck", { workspaceId }, { runAt });
  return true;
}

/** Für alle Sub-Accounts, die den Pflichten-Katalog übernommen haben (z. B. beim Worker-Start aufrufen). */
export async function ensureAutocheckSchedules() {
  const ws = await db.complianceItem.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } });
  let added = 0;
  for (const { workspaceId } of ws) if (await scheduleAutocheck(workspaceId)) added++;
  return added;
}
