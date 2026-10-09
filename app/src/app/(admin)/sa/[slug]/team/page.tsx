import Link from "next/link";
import { db } from "@/lib/db";
import { ensureRoles, ForbiddenError } from "@/lib/permissions";
import { formatDate } from "@/lib/workspace";
import { Badge, Card, Empty, PageHeader, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { StateForm, Submit } from "@/components/users/StateForm";
import { RowAction, SelectAction } from "@/components/users/RowAction";
import { TeamForm } from "@/components/users/TeamForm";
import { NoAccess } from "@/components/users/NoAccess";
import { mayGrant, requireTeamAdmin } from "./guard";
import { changeMemberRole, createTeam, deleteTeam, inviteMember, removeMember, resendMemberInvite, revokeMemberInvite, saveTeam } from "./actions";

export const dynamic = "force-dynamic";

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let ctx;
  try {
    ctx = await requireTeamAdmin(slug);
  } catch (e) {
    if (e instanceof ForbiddenError) return <NoAccess what="die Team-Verwaltung" />;
    throw e;
  }
  const { ws, user, access, staff } = ctx;
  await ensureRoles(ws.id);
  const [members, roles, teams, invitations, agencyStaff] = await Promise.all([
    db.membership.findMany({ where: { workspaceId: ws.id }, include: { user: true, roleRef: true }, orderBy: { user: { name: "asc" } } }),
    db.role.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: "asc" } }),
    db.team.findMany({ where: { workspaceId: ws.id }, include: { members: true }, orderBy: { name: "asc" } }),
    db.invitation.findMany({ where: { workspaceId: ws.id, acceptedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    db.user.findMany({ where: { agencyRole: { in: ["owner", "admin"] }, active: true }, select: { id: true, name: true } }),
  ]);
  const grantable = roles.filter((r) => mayGrant(access, staff, r.permissions));
  const roleOptions = grantable.map((r) => ({ value: r.id, label: r.name }));
  const teamCandidates = [
    ...members.filter((m) => m.user.active).map((m) => ({ id: m.userId, name: m.user.name })),
    ...agencyStaff.filter((a) => !members.some((m) => m.userId === a.id)).map((a) => ({ id: a.id, name: `${a.name} (Agentur)` })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Team" description="Wer hat in diesem Sub-Account Zugriff, mit welcher Rolle, und wer arbeitet in welchem Team (für die Reichweite „Team“).">
        <Link href={`/sa/${slug}/team/rollen`} className={btnGhostCls}>Rollen & Rechte</Link>
      </PageHeader>

      <Card title={`Mitglieder (${members.length})`}>
        <p className="mb-3 text-sm text-ink-400">Inhaber und Admins der Agentur haben zusätzlich immer vollen Zugriff ({agencyStaff.map((a) => a.name).join(", ") || "–"}).</p>
        {members.length === 0 ? (
          <Empty>Noch keine Mitglieder. Laden Sie unten jemanden ein.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {members.map((m) => {
              const self = m.userId === user.id;
              const editable = !self && (!m.roleRef || mayGrant(access, staff, m.roleRef.permissions));
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <div className="font-medium text-ink-900 dark:text-ink-50">{m.user.name}{self && " (Sie)"} {!m.user.active && <Badge tone={m.user.passwordHash === "invited" ? "warn" : "bad"}>{m.user.passwordHash === "invited" ? "eingeladen" : "deaktiviert"}</Badge>}</div>
                    <div className="text-sm text-ink-400">{m.user.email}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {editable ? (
                      <SelectAction action={changeMemberRole.bind(null, slug, m.id)} name="roleId" label={`Rolle von ${m.user.name}`} value={m.roleId ?? ""} options={roleOptions} />
                    ) : (
                      <Badge tone="accent">{m.roleRef?.name ?? "Nur lesen"}</Badge>
                    )}
                    {editable && <RowAction action={removeMember.bind(null, slug, m.id)} label="Entfernen" variant="danger" confirm={`${m.user.name} aus ${ws.name} entfernen?`} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Person einladen">
          <StateForm action={inviteMember.bind(null, slug)}>
            <label className="block"><span className={labelCls}>E-Mail</span><input name="email" type="email" required maxLength={200} className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Name (optional)</span><input name="name" maxLength={120} className={inputCls} /></label>
            <label className="block">
              <span className={labelCls}>Rolle</span>
              <select name="roleKey" defaultValue={grantable.find((r) => r.key === "vertrieb")?.key ?? grantable[0]?.key} className={inputCls}>
                {grantable.map((r) => <option key={r.id} value={r.key}>{r.name}</option>)}
              </select>
            </label>
            <p className="text-sm text-ink-400">Sie können nur Rollen vergeben, die höchstens Ihre eigenen Rechte haben.</p>
            <Submit>Einladung senden</Submit>
          </StateForm>
          {invitations.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold">Offene Einladungen</h3>
              <ul className="divide-y divide-ink-100 dark:divide-white/10">
                {invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                    <span>{i.email} · {roles.find((r) => r.key === i.roleKey)?.name ?? i.roleKey} · bis {formatDate(i.expiresAt)}</span>
                    <span className="flex gap-2">
                      <RowAction action={resendMemberInvite.bind(null, slug, i.id)} label="Erneut senden" />
                      <RowAction action={revokeMemberInvite.bind(null, slug, i.id)} label="Widerrufen" variant="danger" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Teams">
          <p className="mb-3 text-sm text-ink-400">Rollen mit Reichweite „Team“ sehen Datensätze, deren zuständige Person mit ihnen in einem Team ist.</p>
          <div className="space-y-5">
            {teams.map((t) => (
              <div key={t.id} className="rounded-lg border border-ink-100 p-3 dark:border-white/10">
                <TeamForm action={saveTeam.bind(null, slug, t.id)} name={t.name} members={teamCandidates} selected={t.members.map((m) => m.userId)} />
                <div className="mt-2"><RowAction action={deleteTeam.bind(null, slug, t.id)} label="Team löschen" variant="danger" confirm={`Team „${t.name}“ löschen?`} /></div>
              </div>
            ))}
            <StateForm action={createTeam.bind(null, slug)} inline>
              <input name="name" placeholder="Neues Team, z. B. Vertrieb Süd" required maxLength={80} className={`${inputCls} max-w-xs`} aria-label="Name des neuen Teams" />
              <Submit variant="ghost">Team anlegen</Submit>
            </StateForm>
          </div>
        </Card>
      </div>
    </div>
  );
}
