import "server-only";
import { cache } from "react";
import { db } from "../db";
import { DEFAULT_LIFECYCLE, TICKET_STAGES } from "./lifecycle";

// Standard-Einrichtung je Sub-Account (idempotent): Lifecycle-Phasen + Ticket-Pipeline „Support“.

export async function ensureObjectDefaults(workspaceId: string) {
  const count = await db.lifecycleStage.count({ where: { workspaceId } });
  if (count === 0) {
    await db.lifecycleStage.createMany({
      data: DEFAULT_LIFECYCLE.map((s, i) => ({ workspaceId, key: s.key, label: s.label, position: i })),
      skipDuplicates: true,
    });
  }
  const tickets = await db.pipeline.count({ where: { workspaceId, objectType: "ticket" } });
  if (tickets === 0) {
    await db.pipeline.create({
      data: { workspaceId, name: "Support", objectType: "ticket", stages: { create: TICKET_STAGES.map((s, i) => ({ ...s, position: i })) } },
    });
  }
}

/** Einmal pro Request: Standards sicherstellen (lazy beim ersten Seitenaufruf). */
export const ensureDefaultsOnce = cache(ensureObjectDefaults);

export async function lifecycleStages(workspaceId: string) {
  await ensureDefaultsOnce(workspaceId);
  return db.lifecycleStage.findMany({ where: { workspaceId }, orderBy: { position: "asc" } });
}

/** Benutzer, die im Sub-Account als Zuständige wählbar sind (Mitglieder + Agentur-Admins). */
export async function ownerOptions(workspaceId: string) {
  return db.user.findMany({
    // nur aktive Konten (deaktivierte bzw. nicht angenommene Einladungen sind nicht zuweisbar)
    where: { active: true, OR: [{ isAgencyAdmin: true }, { agencyRole: { in: ["owner", "admin"] } }, { memberships: { some: { workspaceId } } }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
}

/** Prüft, ob eine Benutzer-ID als Zuständige im Sub-Account zulässig ist. */
export async function isValidOwner(workspaceId: string, userId: string) {
  const u = await db.user.findFirst({
    where: { id: userId, active: true, OR: [{ isAgencyAdmin: true }, { agencyRole: { in: ["owner", "admin"] } }, { memberships: { some: { workspaceId } } }] },
    select: { id: true },
  });
  return !!u;
}
