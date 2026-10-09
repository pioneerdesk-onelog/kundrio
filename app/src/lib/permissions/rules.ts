import type { Permissions, ObjectKey } from "./catalog";
import { OBJECTS } from "./catalog";

// Reine Regeln (ohne DB), testbar: Zuständige setzen, Vier-Augen.

/**
 * Darf jemand die Zuständige eines Datensatzes auf `newOwnerId` setzen?
 * Reichweite „bearbeiten“: alle → beliebig; Team → sich, Teamkollegen oder niemand; eigene → sich oder niemand.
 */
export function canSetOwner(
  perms: Permissions,
  object: ObjectKey,
  ctx: { userId: string; teamUserIds: string[] },
  newOwnerId: string | null,
): boolean {
  const scope = perms.objects[object].edit;
  if (scope === "all") return true;
  if (scope === "none" || !OBJECTS[object].owned) return false;
  if (newOwnerId === null || newOwnerId === ctx.userId) return true;
  return scope === "team" && ctx.teamUserIds.includes(newOwnerId);
}

/** Akteur-Kennungen, die zu einem Benutzer gehören: user:<id>, oauth:<token>:user:<id> */
export function actorIsUser(actor: string | null | undefined, userId: string): boolean {
  if (!actor) return false;
  return actor === `user:${userId}` || actor.endsWith(`:user:${userId}`);
}

/** Vier-Augen-Prinzip: Antragsteller darf die eigene Freigabe nicht erteilen. */
export function fourEyesBlocks(fourEyes: boolean, requestedBy: string, deciderUserId: string): boolean {
  return fourEyes && actorIsUser(requestedBy, deciderUserId);
}
