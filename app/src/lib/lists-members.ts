import "server-only";
import { db } from "./db";
import { ApiError } from "./lists-api";
import { normalizeEmail } from "./migrate/brevo-map";

type Target = { id: string; email: string | null };

/** Gemeinsame Logik für /contacts/lists/{id}/contacts/add|remove (Brevo-Format). */
export async function resolveMemberTargets(
  workspaceId: string,
  body: Record<string, unknown>,
  allowAll: boolean,
): Promise<{ found: Target[]; failure: string[]; all: boolean }> {
  const emails = body.emails;
  const ids = body.ids;
  if (allowAll && body.all === true) return { found: [], failure: [], all: true };
  if (Array.isArray(emails)) {
    if (emails.length > 150) throw new ApiError(400, "invalid_parameter", "Maximum 150 emails per request");
    const valid = emails.map(normalizeEmail);
    const rows = await db.contact.findMany({
      where: { workspaceId, email: { in: valid.filter((e): e is string => !!e) } },
      select: { id: true, email: true },
    });
    const failure = emails.map(String).filter((_, i) => !valid[i] || !rows.some((r) => r.email === valid[i]));
    return { found: rows, failure, all: false };
  }
  if (Array.isArray(ids)) {
    if (ids.length > 150) throw new ApiError(400, "invalid_parameter", "Maximum 150 ids per request");
    const strIds = ids.map(String);
    const rows = await db.contact.findMany({ where: { workspaceId, id: { in: strIds } }, select: { id: true, email: true } });
    return { found: rows, failure: strIds.filter((i) => !rows.some((r) => r.id === i)), all: false };
  }
  throw new ApiError(400, "missing_parameter", allowAll ? "emails, ids or all is required" : "emails or ids is required");
}
