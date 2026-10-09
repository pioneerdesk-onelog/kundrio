import "server-only";
import { isAgencyStaff, requireAccess, type Access } from "@/lib/permissions";
import { isSubset } from "@/lib/permissions/escalation";
import { parsePermissions, type Permissions } from "@/lib/permissions/catalog";

// Gemeinsame Prüfungen für Team- und Rollenverwaltung (Recht manage_users + Eskalationsschutz).

export async function requireTeamAdmin(slug: string) {
  const ctx = await requireAccess(slug, { special: "manage_users" });
  return { ...ctx, staff: isAgencyStaff(ctx.user) };
}

/** Darf der Handelnde eine Rolle mit diesen Rechten vergeben bzw. setzen? */
export function mayGrant(access: Access, staff: boolean, perms: Permissions | unknown) {
  if (staff) return true;
  return isSubset(parsePermissions(perms), access.perms);
}
