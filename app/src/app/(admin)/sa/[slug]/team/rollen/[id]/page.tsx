import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { parsePermissions } from "@/lib/permissions/catalog";
import { Card, PageHeader, btnGhostCls } from "@/components/ui";
import { RoleMatrix } from "@/components/users/RoleMatrix";
import { RowAction } from "@/components/users/RowAction";
import { NoAccess } from "@/components/users/NoAccess";
import { mayGrant, requireTeamAdmin } from "../../guard";
import { deleteRole, resetRole, saveRole } from "../actions";

export const dynamic = "force-dynamic";

export default async function RolePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  let ctx;
  try {
    ctx = await requireTeamAdmin(slug);
  } catch (e) {
    if (e instanceof ForbiddenError) return <NoAccess what="die Rollenverwaltung" />;
    throw e;
  }
  const { ws, user, access, staff } = ctx;
  const role = await db.role.findFirst({ where: { id, workspaceId: ws.id }, include: { _count: { select: { memberships: true } } } });
  if (!role) notFound();
  const own = staff ? null : await db.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId: ws.id } } });
  const reason =
    role.key === "admin"
      ? "Die Admin-Rolle ist geschützt: Sie hat immer alle Rechte, damit sich niemand aussperrt."
      : own?.roleId === role.id
        ? "Das ist Ihre eigene Rolle – ändern kann sie nur ein anderer Admin."
        : !mayGrant(access, staff, role.permissions)
          ? "Diese Rolle hat mehr Rechte als Sie und kann daher nicht von Ihnen geändert werden."
          : null;
  return (
    <div className="space-y-6">
      <PageHeader title={`Rolle: ${role.name}`} description={`${role._count.memberships} Mitglied(er) · ${role.presetKey ? "aus Vorlage" : "eigene Rolle"}`}>
        <Link href={`/sa/${slug}/team/rollen`} className={btnGhostCls}>Alle Rollen</Link>
      </PageHeader>
      {reason && <p className="rounded-lg bg-amber-50 px-4 py-3 text-[15px] text-amber-900 dark:bg-amber-500/15 dark:text-amber-100">{reason}</p>}
      <Card>
        <RoleMatrix action={saveRole.bind(null, slug, role.id)} name={role.name} description={role.description ?? ""} permissions={parsePermissions(role.permissions)} readOnly={!!reason} />
      </Card>
      {!reason && (
        <div className="flex flex-wrap gap-3">
          {role.presetKey && <RowAction action={resetRole.bind(null, slug, role.id)} label="Auf Vorlage zurücksetzen" confirm="Alle Anpassungen dieser Rolle verwerfen?" />}
          {!role.presetKey && <RowAction action={deleteRole.bind(null, slug, role.id)} label="Rolle löschen" variant="danger" confirm="Rolle löschen?" />}
        </div>
      )}
    </div>
  );
}
