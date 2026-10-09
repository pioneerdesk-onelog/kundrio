import "server-only";
import { cache } from "react";
import { requireUser } from "../auth";
import { getWorkspace } from "../workspace";
import { OBJECTS, allows, type Action, type ObjectKey, type Special } from "./catalog";

export * from "./catalog";
export { computeAccess, ensureRoles, isAgencyStaff, userIdFromActor, type Access } from "./core";
import { computeAccess, ensureRoles, type Access } from "./core";

// Zentrale Berechtigungsprüfung. Jede Seite/Action im internen Bereich prüft hierüber.
// Agentur-Inhaber/-Admin: volle Rechte in allen Sub-Accounts. Sonst: Rolle der Mitgliedschaft.

export class ForbiddenError extends Error {
  constructor(message = "Dafür fehlt die Berechtigung.") {
    super(message);
  }
}

const ensureRolesOnce = cache(ensureRoles);

/** Rechte des Benutzers im Sub-Account (null = kein Zugriff). Pro Request zwischengespeichert. */
export const getAccess = cache(async (userId: string, workspaceId: string): Promise<Access | null> => {
  await ensureRolesOnce(workspaceId);
  return computeAccess(userId, workspaceId, { ensure: false });
});

export function can(access: Access, object: ObjectKey, action: Action, recordOwnerId?: string | null) {
  return allows(access.perms, object, action, { userId: access.userId, recordOwnerId, teamUserIds: access.teamUserIds });
}

export function hasSpecial(access: Access, special: Special) {
  return access.perms.special[special];
}

/** Wirft ForbiddenError, wenn die Aktion nicht erlaubt ist. */
export function assertCan(access: Access, object: ObjectKey, action: Action, recordOwnerId?: string | null) {
  if (!can(access, object, action, recordOwnerId)) {
    throw new ForbiddenError(`Keine Berechtigung: ${OBJECTS[object].label} ${action === "read" ? "lesen" : action === "edit" ? "bearbeiten" : "löschen"}.`);
  }
}

export function assertSpecial(access: Access, special: Special) {
  if (!hasSpecial(access, special)) throw new ForbiddenError("Dafür fehlt die Berechtigung.");
}

/**
 * Prisma-Filter für Listen/Abfragen nach Reichweite (nur für Objekte mit `ownerId`).
 * all → {} · team → Zuständige im Team oder ohne Zuständige · own → eigene oder ohne Zuständige · none → nichts
 */
export function scopeWhere(access: Access, object: ObjectKey, action: Action = "read"): { ownerId?: unknown; id?: unknown } {
  const scope = access.perms.objects[object][action];
  if (scope === "all") return {};
  if (scope === "none" || !OBJECTS[object].owned) return { id: { in: [] } };
  const ids = scope === "own" ? [access.userId] : access.teamUserIds;
  return { OR: [{ ownerId: { in: ids } }, { ownerId: null }] } as unknown as { ownerId?: unknown };
}

/**
 * Für Seiten und Server Actions im Sub-Account: Workspace laden (Anmeldung + Zugriff) und Rechte liefern.
 * Optional direkt eine Mindestberechtigung verlangen.
 */
export async function requireAccess(slug: string, need?: { object: ObjectKey; action: Action } | { special: Special }) {
  const user = await requireUser();
  const ws = await getWorkspace(slug);
  const access = await getAccess(user.id, ws.id);
  if (!access) throw new ForbiddenError("Kein Zugriff auf diesen Sub-Account.");
  if (need) {
    if ("special" in need) assertSpecial(access, need.special);
    else assertCan(access, need.object, need.action);
  }
  return { user, ws, access };
}
