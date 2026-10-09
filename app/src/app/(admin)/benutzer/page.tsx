import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ensureRoles, isAgencyStaff } from "@/lib/permissions";
import { formatDate } from "@/lib/workspace";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { AgencyInviteForm } from "@/components/users/AgencyInviteForm";
import { NoAccess } from "@/components/users/NoAccess";
import { RowAction, SelectAction } from "@/components/users/RowAction";
import { inviteAgencyUser, resendInvite, revokeInvite, setActive, setAgencyRole } from "./actions";

export const dynamic = "force-dynamic";

const AGENCY_LABEL: Record<string, string> = { owner: "Inhaber", admin: "Admin", member: "Mitarbeiter" };

export default async function UsersPage() {
  const me = await requireUser();
  if (!isAgencyStaff(me)) return <NoAccess what="die Benutzerverwaltung der Agentur" scope="agency" />;
  const workspaces = await db.workspace.findMany({ orderBy: { name: "asc" } });
  for (const w of workspaces) await ensureRoles(w.id);
  const [users, roles, invitations, lastLogins] = await Promise.all([
    db.user.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { memberships: { include: { workspace: true, roleRef: true } } },
    }),
    db.role.findMany({ orderBy: { createdAt: "asc" }, select: { workspaceId: true, key: true, name: true } }),
    db.invitation.findMany({ where: { acceptedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" }, include: { workspace: true } }),
    db.session.groupBy({ by: ["userId"], _max: { createdAt: true } }),
  ]);
  const lastLogin = new Map(lastLogins.map((l) => [l.userId, l._max.createdAt]));
  const isOwner = me.agencyRole === "owner";
  const wsWithRoles = workspaces.map((w) => ({ id: w.id, name: w.name, roles: roles.filter((r) => r.workspaceId === w.id) }));
  const roleName = (wsId: string | null, key: string | null) => roles.find((r) => r.workspaceId === wsId && r.key === key)?.name ?? key ?? "–";

  return (
    <div className="space-y-6">
      <PageHeader title="Benutzer" description="Alle Personen mit Zugang zur Agentur und zu den Sub-Accounts. Inhaber und Admins sehen alle Sub-Accounts, Mitarbeiter nur die zugewiesenen." />

      <Card title="Person einladen">
        <AgencyInviteForm action={inviteAgencyUser} workspaces={wsWithRoles} canGrantPrivileged={isOwner} />
      </Card>

      <Card title={`Benutzer (${users.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-ink-100 text-left text-sm text-ink-400 dark:border-white/10">
                <th className="py-2 pr-3 font-medium">Person</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Agentur-Rolle</th>
                <th className="py-2 pr-3 font-medium">Sub-Accounts</th>
                <th className="py-2 pr-3 font-medium">Letzte Anmeldung</th>
                <th className="py-2 font-medium"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const invited = u.passwordHash === "invited";
                const self = u.id === me.id;
                const privileged = u.agencyRole === "owner" || u.agencyRole === "admin";
                const mayChange = !self && (isOwner || !privileged);
                return (
                  <tr key={u.id} className="border-b border-ink-100 align-top last:border-0 dark:border-white/10">
                    <td className="py-3 pr-3">
                      <div className="font-medium text-ink-900 dark:text-ink-50">{u.name}{self && " (Sie)"}</div>
                      <div className="text-sm text-ink-400">{u.email}</div>
                    </td>
                    <td className="py-3 pr-3">
                      {invited ? <Badge tone="warn">eingeladen</Badge> : u.active ? <Badge tone="ok">aktiv</Badge> : <Badge tone="bad">deaktiviert</Badge>}
                    </td>
                    <td className="py-3 pr-3">
                      <SelectAction
                        action={setAgencyRole.bind(null, u.id)}
                        name="agencyRole"
                        label={`Agentur-Rolle von ${u.name}`}
                        value={u.agencyRole}
                        disabled={!mayChange || invited}
                        options={(isOwner ? ["owner", "admin", "member"] : ["member"].concat(privileged ? [u.agencyRole] : [])).map((r) => ({ value: r, label: AGENCY_LABEL[r] }))}
                      />
                    </td>
                    <td className="py-3 pr-3 text-sm">
                      {privileged ? (
                        <span className="text-ink-400">alle</span>
                      ) : u.memberships.length === 0 ? (
                        <span className="text-ink-400">keine</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {u.memberships.map((m) => (
                            <li key={m.id}>{m.workspace.name}: {m.roleRef?.name ?? "Nur lesen"}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-sm text-ink-400">{formatDate(lastLogin.get(u.id) ?? null, true)}</td>
                    <td className="py-3">
                      {mayChange && !invited &&
                        (u.active ? (
                          <RowAction action={setActive.bind(null, u.id, false)} label="Deaktivieren" variant="danger" confirm={`${u.name} deaktivieren? Alle Sitzungen werden beendet.`} />
                        ) : (
                          <RowAction action={setActive.bind(null, u.id, true)} label="Reaktivieren" />
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Offene Einladungen">
        {invitations.length === 0 ? (
          <Empty>Keine offenen Einladungen.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[15px]">
                <div>
                  <div className="font-medium">{i.email}</div>
                  <div className="text-sm text-ink-400">
                    {i.workspace ? `${i.workspace.name} · ${roleName(i.workspaceId, i.roleKey)}` : `Agentur · ${AGENCY_LABEL[i.agencyRole ?? "member"]}`} · gültig bis {formatDate(i.expiresAt)}
                    {i.expiresAt < new Date() && " (abgelaufen)"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <RowAction action={resendInvite.bind(null, i.id)} label="Erneut senden" />
                  <RowAction action={revokeInvite.bind(null, i.id)} label="Widerrufen" variant="danger" confirm="Einladung widerrufen?" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
