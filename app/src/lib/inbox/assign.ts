import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { parseInboxConfig } from "./config";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Zuständige Person für ein neues Gespräch. Rundlauf = wer im Sub-Account aktuell die wenigsten
 * offenen Gespräche hat (gleichmäßige Verteilung, robust gegen gleichzeitige Eingänge).
 * Kandidaten: in der Inbox hinterlegte Personen, sonst alle aktiven Mitglieder des Sub-Accounts.
 */
export async function pickAssignee(inbox: { workspaceId: string; config: unknown }, tx: Tx = db): Promise<string | null> {
  const cfg = parseInboxConfig(inbox.config);
  if (cfg.assignment !== "round_robin") return null;

  let candidates = cfg.assigneeIds;
  if (candidates.length === 0) {
    const members = await tx.membership.findMany({
      where: { workspaceId: inbox.workspaceId, user: { active: true } },
      select: { userId: true },
    });
    candidates = members.map((m) => m.userId);
  } else {
    // nur noch aktive Benutzer mit Zugang (Mitglied oder Agentur-Staff)
    const ok = await tx.user.findMany({
      where: {
        id: { in: candidates },
        active: true,
        OR: [{ memberships: { some: { workspaceId: inbox.workspaceId } } }, { agencyRole: { in: ["owner", "admin"] } }],
      },
      select: { id: true },
    });
    candidates = ok.map((u) => u.id);
  }
  if (candidates.length === 0) return null;

  const load = await tx.conversation.groupBy({
    by: ["assigneeId"],
    where: { workspaceId: inbox.workspaceId, assigneeId: { in: candidates }, status: { in: ["open", "pending"] } },
    _count: true,
  });
  const count = new Map(load.map((l) => [l.assigneeId, l._count]));
  // stabil sortieren: geringste Last, dann Reihenfolge der Kandidaten
  return [...candidates].sort((a, b) => (count.get(a) ?? 0) - (count.get(b) ?? 0))[0] ?? null;
}
