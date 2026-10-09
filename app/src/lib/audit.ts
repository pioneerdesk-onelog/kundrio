import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { errMessage, log } from "@/lib/log";

// Wer hat was getan? Akteure: user:<id> | apikey:<id> | mcp:<keyId> | process:<runId> | system
export async function audit(entry: { workspaceId?: string | null; actor: string; action: string; target?: string; detail?: Record<string, unknown> }) {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: entry.workspaceId ?? null,
        actor: entry.actor,
        action: entry.action,
        target: entry.target,
        detail: entry.detail as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (e) {
    // Protokollfehler dürfen die eigentliche Aktion nicht verhindern, werden aber sichtbar gemacht
    log.error("audit log write failed", { error: errMessage(e) });
  }
}
