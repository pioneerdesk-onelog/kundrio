import Link from "next/link";
import { db } from "@/lib/db";
import { ensureRoles, ForbiddenError } from "@/lib/permissions";
import { Badge, Card, PageHeader, btnGhostCls, inputCls } from "@/components/ui";
import { StateForm, Submit } from "@/components/users/StateForm";
import { NoAccess } from "@/components/users/NoAccess";
import { mayGrant, requireTeamAdmin } from "../guard";
import { createRole } from "./actions";

export const dynamic = "force-dynamic";

export default async function RolesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let ctx;
  try {
    ctx = await requireTeamAdmin(slug);
  } catch (e) {
    if (e instanceof ForbiddenError) return <NoAccess what="die Rollenverwaltung" />;
    throw e;
  }
  const { ws, access, staff } = ctx;
  await ensureRoles(ws.id);
  const roles = await db.role.findMany({ where: { workspaceId: ws.id }, include: { _count: { select: { memberships: true } } }, orderBy: { createdAt: "asc" } });
  const copyable = roles.filter((r) => mayGrant(access, staff, r.permissions));
  return (
    <div className="space-y-6">
      <PageHeader title="Rollen & Rechte" description="Vorlagen nach Best Practice – passen Sie sie an oder legen Sie eigene Rollen als Kopie an.">
        <Link href={`/sa/${slug}/team`} className={btnGhostCls}>Zurück zum Team</Link>
      </PageHeader>
      <Card>
        <ul className="divide-y divide-ink-100 dark:divide-white/10">
          {roles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <Link href={`/sa/${slug}/team/rollen/${r.id}`} className="font-medium text-ink-900 hover:underline dark:text-ink-50">{r.name}</Link>
                {r.presetKey ? <Badge tone="neutral">Vorlage</Badge> : <Badge tone="accent">eigene</Badge>}
                {r.key === "admin" && <Badge tone="warn">geschützt</Badge>}
                <div className="text-sm text-ink-400">{r.description}</div>
              </div>
              <span className="text-sm text-ink-400">{r._count.memberships} Mitglied(er)</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Eigene Rolle anlegen">
        <StateForm action={createRole.bind(null, slug)} inline>
          <input name="name" required maxLength={60} placeholder="z. B. Vertrieb Innendienst" className={`${inputCls} max-w-xs`} aria-label="Name der neuen Rolle" />
          <select name="fromId" className={`${inputCls} max-w-56`} aria-label="Als Kopie von" defaultValue={copyable.find((r) => r.key === "vertrieb")?.id}>
            {copyable.map((r) => <option key={r.id} value={r.id}>Kopie von: {r.name}</option>)}
          </select>
          <Submit variant="ghost">Anlegen</Submit>
        </StateForm>
      </Card>
    </div>
  );
}
