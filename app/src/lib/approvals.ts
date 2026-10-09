import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { computeAccess, userIdFromActor } from "./permissions/core";
import { fourEyesBlocks } from "./permissions/rules";

// Freigabe-Eingang: Aktionen mit Außenwirkung (aus MCP, Prozessen, KI) werden hier abgelegt und
// erst ausgeführt, wenn ein Mensch zustimmt. Ausführende Funktionen registrieren sich je `kind`.

export type ApprovalExecutor = (payload: Record<string, unknown>, ctx: { workspaceId: string; decidedBy: string }) => Promise<Record<string, unknown> | void>;

const executors = new Map<string, { label: string; run: ApprovalExecutor }>();

/** Registriert, was bei Zustimmung passiert (einmal je kind, z. B. beim Import des Moduls). */
export function registerApprovalKind(kind: string, label: string, run: ApprovalExecutor) {
  executors.set(kind, { label, run });
}

export function approvalLabel(kind: string) {
  return executors.get(kind)?.label ?? kind;
}

export async function requestApproval(input: {
  workspaceId: string;
  kind: string;
  title: string;
  summary?: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  expiresInDays?: number;
}) {
  const a = await db.approval.create({
    data: {
      workspaceId: input.workspaceId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      summary: input.summary?.slice(0, 2000),
      payload: input.payload as Prisma.InputJsonValue,
      requestedBy: input.requestedBy,
      expiresAt: new Date(Date.now() + (input.expiresInDays ?? 14) * 864e5),
    },
  });
  await audit({ workspaceId: input.workspaceId, actor: input.requestedBy, action: "approval.requested", target: a.id, detail: { kind: input.kind } });
  return a;
}

/** Entscheidung eines Menschen. Bei Zustimmung wird der registrierte Ausführer aufgerufen. */
export async function decideApproval(approvalId: string, workspaceId: string, decision: "approved" | "rejected", decidedBy: string) {
  // Entscheiden dürfen nur Menschen mit dem Recht „Freigaben erteilen“ – bei Vier-Augen nie die eigene Anfrage
  const deciderId = userIdFromActor(decidedBy);
  if (!deciderId) throw new Error("Freigaben können nur von Menschen entschieden werden.");
  const [access, pending, ws] = await Promise.all([
    computeAccess(deciderId, workspaceId),
    db.approval.findFirst({ where: { id: approvalId, workspaceId }, select: { requestedBy: true } }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { fourEyes: true } }),
  ]);
  if (!access?.perms.special.approve) throw new Error("Dafür fehlt das Recht „Freigaben erteilen“.");
  if (pending && fourEyesBlocks(ws?.fourEyes ?? false, pending.requestedBy, deciderId)) {
    throw new Error("Vier-Augen-Prinzip: Eigene Anfragen muss eine andere Person freigeben oder ablehnen.");
  }
  // Nur offene, nicht abgelaufene Freigaben – atomar beanspruchen, damit nichts doppelt läuft
  const claimed = await db.approval.updateMany({
    where: { id: approvalId, workspaceId, status: "pending", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    data: { status: decision === "approved" ? "running" : "rejected", decidedBy, decidedAt: new Date() },
  });
  if (claimed.count === 0) throw new Error("Freigabe ist nicht mehr offen.");
  await audit({ workspaceId, actor: decidedBy, action: `approval.${decision}`, target: approvalId });
  if (decision === "rejected") return { status: "rejected" as const };

  const a = await db.approval.findUniqueOrThrow({ where: { id: approvalId } });
  const ex = executors.get(a.kind);
  try {
    if (!ex) throw new Error(`Keine Ausführung für „${a.kind}“ registriert.`);
    const result = await ex.run(a.payload as Record<string, unknown>, { workspaceId, decidedBy });
    await db.approval.update({ where: { id: a.id }, data: { status: "approved", result: (result ?? {}) as Prisma.InputJsonValue } });
    return { status: "approved" as const, result };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 500);
    await db.approval.update({ where: { id: a.id }, data: { status: "failed", result: { error: msg } } });
    throw e;
  }
}
