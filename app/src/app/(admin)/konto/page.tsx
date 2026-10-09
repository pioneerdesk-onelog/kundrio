import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { isDemoGuest } from "@/lib/demo";
import Link from "next/link";
import { Card, PageHeader, btnCls, inputCls } from "@/components/ui";

async function changePassword(formData: FormData) {
  "use server";
  const user = await requireUser();
  if (isDemoGuest(user.email)) throw new Error("Im Demo-Gastkonto lässt sich das Passwort nicht ändern.");
  const data = z
    .object({ current: z.string().min(1), next: z.string().min(12, "Mindestens 12 Zeichen").max(200) })
    .parse({ current: formData.get("current"), next: formData.get("next") });
  if (!(await verifyPassword(data.current, user.passwordHash))) throw new Error("Aktuelles Passwort ist falsch.");
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(data.next) } });
  // Alle Sitzungen beenden, auch die aktuelle → neu anmelden
  await db.session.deleteMany({ where: { userId: user.id } });
  redirect("/login");
}

const AGENCY_LABEL: Record<string, string> = { owner: "Inhaber", admin: "Admin", member: "Mitarbeiter" };

export default async function KontoPage() {
  const user = await requireUser();
  const [memberships, teams] = await Promise.all([
    db.membership.findMany({ where: { userId: user.id }, include: { workspace: true, roleRef: true }, orderBy: { workspace: { name: "asc" } } }),
    db.teamMember.findMany({ where: { userId: user.id }, include: { team: { include: { workspace: true } } } }),
  ]);
  const agencyStaff = user.agencyRole === "owner" || user.agencyRole === "admin";
  return (
    <div className="max-w-xl">
      <PageHeader title="Mein Konto" />
      <Card title="Angemeldet als">
        <p>{user.name} · {user.email}</p>
        <p className="mt-1 text-sm text-ink-400">Agentur-Rolle: {AGENCY_LABEL[user.agencyRole] ?? user.agencyRole}{agencyStaff && " – voller Zugriff auf alle Sub-Accounts"}</p>
      </Card>
      <Card title="Meine Rollen und Teams" className="mt-4">
        {memberships.length === 0 ? (
          <p className="text-[15px] text-ink-400">{agencyStaff ? "Keine einzelnen Zuweisungen nötig – Sie sehen alle Sub-Accounts." : "Noch keinem Sub-Account zugewiesen."}</p>
        ) : (
          <ul className="space-y-1 text-[15px]">
            {memberships.map((m) => (
              <li key={m.id}>
                <b>{m.workspace.name}</b>: {m.roleRef?.name ?? "Nur lesen"}
                {teams.filter((t) => t.team.workspaceId === m.workspaceId).length > 0 &&
                  ` · Teams: ${teams.filter((t) => t.team.workspaceId === m.workspaceId).map((t) => t.team.name).join(", ")}`}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Verbundene Apps" className="mt-4">
        <p className="text-sm text-ink-600 dark:text-ink-200">KI-Assistenten (z. B. claude.ai, ChatGPT), denen Sie per OAuth Zugriff gegeben haben.</p>
        <Link href="/konto/apps" className="mt-2 inline-block text-sm font-medium text-accent-500 dark:text-accent-100 hover:underline">Verbundene Apps verwalten →</Link>
        <Link href="/konto/kalender" className="mt-2 ml-4 inline-block text-sm font-medium text-accent-500 dark:text-accent-100 hover:underline">Kalender verbinden (Google/Microsoft) →</Link>
      </Card>
      <Card title="Passwort ändern" className="mt-4">
        <form action={changePassword} className="space-y-3">
          <input name="current" type="password" placeholder="Aktuelles Passwort" autoComplete="current-password" required className={inputCls} />
          <input name="next" type="password" placeholder="Neues Passwort (mind. 12 Zeichen)" autoComplete="new-password" minLength={12} required className={inputCls} />
          <button className={btnCls}>Ändern</button>
          <p className="text-xs text-ink-400">Danach müssen Sie sich überall neu anmelden.</p>
        </form>
      </Card>
    </div>
  );
}
