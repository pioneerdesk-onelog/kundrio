import "server-only";
import { redirect } from "next/navigation";
import { requireUser } from "../auth";
import { getWorkspace } from "../workspace";
import { ForbiddenError, can, getAccess, hasSpecial, scopeWhere, type Access } from "./index";
import type { Need } from "./areas";
import { canSetOwner } from "./rules";
import type { ObjectKey } from "./catalog";

export function meets(access: Access, need: Need): boolean {
  if ("anyOf" in need) return need.anyOf.some((n) => meets(access, n));
  if ("special" in need) return hasSpecial(access, need.special);
  return can(access, need.object, need.action);
}

/** Sub-Account + Rechte für Seiten (null-Zugriff → ForbiddenError). */
export async function pageAccess(slug: string) {
  const user = await requireUser();
  const ws = await getWorkspace(slug);
  const access = await getAccess(user.id, ws.id);
  if (!access) throw new ForbiddenError("Kein Zugriff auf diesen Sub-Account.");
  return { user, ws, access };
}

/** Für Server Actions/Route-Handler: lädt Sub-Account + Rechte und verlangt `need`. Wirft ForbiddenError. */
export async function guard(slug: string, need?: Need) {
  const ctx = await pageAccess(slug);
  if (need && !meets(ctx.access, need)) throw new ForbiddenError();
  return ctx;
}

/** Datensatz-Prüfung (Reichweite): wirft ForbiddenError. */
export function assertRecord(access: Access, object: ObjectKey, action: "read" | "edit" | "delete", ownerId: string | null | undefined) {
  if (!can(access, object, action, ownerId ?? null)) {
    throw new ForbiddenError(action === "read" ? "Datensatz nicht gefunden oder keine Berechtigung." : "Keine Berechtigung für diesen Datensatz.");
  }
}

/** Zuständige setzen nur innerhalb der eigenen Reichweite. */
export function assertOwnerAssignable(access: Access, object: ObjectKey, newOwnerId: string | null) {
  if (!canSetOwner(access.perms, object, { userId: access.userId, teamUserIds: access.teamUserIds }, newOwnerId)) {
    throw new ForbiddenError("Diese Person dürfen Sie nicht als Zuständige eintragen.");
  }
}

/** Für Actions mit Rückgabezustand: ForbiddenError als Inline-Fehler statt 500. */
export function forbiddenToState(e: unknown): { error: string } | null {
  return e instanceof ForbiddenError ? { error: e.message } : null;
}

/** Prisma-where mit Reichweite verknüpfen (AND, damit vorhandene OR-Suchen nicht kollidieren). */
export function withScope<W extends object>(where: W, access: Access, object: ObjectKey, action: "read" | "edit" | "delete" = "read") {
  return { AND: [where, scopeWhere(access, object, action)] } as unknown as W;
}

/** Für Route-Handler: wie guard(), aber gibt bei fehlendem Recht eine 403-Antwort zurück. */
export async function routeGuard(slug: string, need?: Need): Promise<Awaited<ReturnType<typeof guard>> | Response> {
  try {
    return await guard(slug, need);
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    throw e;
  }
}

/**
 * Für Actions mit Redirect-Rückmeldung (?fehler=…): wie guard(), leitet bei fehlendem Recht
 * mit verständlicher Meldung zurück statt einen Fehler zu werfen.
 */
export async function guardOrRedirect(slug: string, need: Need | undefined, back: string) {
  let ctx: Awaited<ReturnType<typeof guard>> | null = null;
  try {
    ctx = await guard(slug, need);
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
    const sep = back.includes("?") ? "&" : "?";
    redirect(`${back}${sep}fehler=${encodeURIComponent(e.message)}`);
  }
  return ctx!;
}

/** Datensatz-Prüfung mit Redirect-Rückmeldung. */
export function recordOrRedirect(access: Access, object: ObjectKey, action: "read" | "edit" | "delete", ownerId: string | null | undefined, back: string) {
  if (!can(access, object, action, ownerId ?? null)) {
    const sep = back.includes("?") ? "&" : "?";
    redirect(`${back}${sep}fehler=${encodeURIComponent("Keine Berechtigung für diesen Datensatz.")}`);
  }
}

/** Sub-Accounts, in denen der Benutzer ein Sonderrecht hat (z. B. „Freigaben erteilen“ für den Freigabe-Eingang). */
export async function workspacesWithSpecial(userId: string, workspaceIds: string[], special: Parameters<typeof hasSpecial>[1]) {
  const out: string[] = [];
  for (const id of workspaceIds) {
    const a = await getAccess(userId, id);
    if (a && hasSpecial(a, special)) out.push(id);
  }
  return out;
}
