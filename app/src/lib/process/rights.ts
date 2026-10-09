import "server-only";
import { db } from "@/lib/db";
import { can, hasSpecial, parsePermissions, type Access } from "@/lib/permissions";
import { ensureRoles } from "@/lib/permissions/core";

/**
 * „Wer darf was“ bei Prozessen: eigene Rechte + Rollen des Sub-Accounts, die das haben.
 * Rollen werden aus den (anpassbaren) Rollen des Sub-Accounts gelesen, nicht hart kodiert.
 */
export async function processRights(workspaceId: string, access: Access) {
  await ensureRoles(workspaceId);
  const roles = (await db.role.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { name: true, permissions: true } })).map((r) => ({
    name: r.name,
    p: parsePermissions(r.permissions),
  }));
  const who = (test: (p: ReturnType<typeof parsePermissions>) => boolean) => roles.filter((r) => test(r.p)).map((r) => r.name);
  return {
    items: [
      { label: "ansehen", yes: can(access, "processes", "read"), roles: who((p) => p.objects.processes.read !== "none") },
      { label: "bearbeiten", yes: can(access, "processes", "edit"), roles: who((p) => p.objects.processes.edit !== "none") },
      {
        label: "veröffentlichen",
        yes: can(access, "processes", "edit") && hasSpecial(access, "publish_processes"),
        roles: who((p) => p.objects.processes.edit !== "none" && p.special.publish_processes),
      },
      { label: "Außenwirkung freigeben", yes: hasSpecial(access, "approve"), roles: who((p) => p.special.approve) },
    ],
  };
}
