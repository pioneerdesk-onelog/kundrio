import Link from "next/link";
import { BarChart3, Gauge, Inbox, LayoutDashboard, LogOut, ShieldCheck, UserRound, Users } from "lucide-react";
import { listWorkspaces } from "@/lib/workspace";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { logout } from "@/app/(public)/login/actions";
import { can, getAccess, isAgencyStaff } from "@/lib/permissions";
import { workspacesWithSpecial } from "@/lib/permissions/guard";
import { KundrioLogo } from "./KundrioLogo";
import { SidebarMenu } from "./SidebarMenu";

const item = "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[15px] text-ink-800 hover:bg-sand-100 dark:text-ink-100 dark:hover:bg-white/10";

export async function Sidebar() {
  const [user, workspaces, agency] = await Promise.all([requireUser(), listWorkspaces(), db.agency.findFirst({ select: { name: true } })]);
  // Offene Freigaben in Sub-Accounts, in denen der Benutzer „Freigaben erteilen“ darf
  const adminWs = await workspacesWithSpecial(user.id, workspaces.map((w) => w.id), "approve");
  const pendingApprovals = adminWs.length
    ? await db.approval.count({ where: { workspaceId: { in: adminWs }, status: "pending", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })
    : 0;
  // Ungelesene Gespräche im Posteingang je Sub-Account (nur mit Leserecht E-Mail)
  const inboxWs: string[] = [];
  for (const w of workspaces) {
    const a = await getAccess(user.id, w.id);
    if (a && can(a, "email", "read")) inboxWs.push(w.id);
  }
  const unreadRows = inboxWs.length
    ? await db.conversation.groupBy({ by: ["workspaceId"], where: { workspaceId: { in: inboxWs }, status: { in: ["open", "pending"] }, unread: { gt: 0 } }, _count: true })
    : [];
  const unreadOf = (id: string) => unreadRows.find((r) => r.workspaceId === id)?._count ?? 0;
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-ink-100 bg-white px-3 py-4 md:sticky md:top-0 md:h-screen md:w-64 md:border-r md:border-b-0 md:py-5 dark:border-white/10 dark:bg-ink-900">
      <SidebarMenu brand={
      <Link href="/" className="block px-2.5" aria-label="Zur Agentur-Übersicht">
        <KundrioLogo className="h-7" />
        <span className="mt-1 block text-xs text-ink-400 dark:text-ink-200">Agentur: {agency?.name ?? "–"}</span>
      </Link>
      }>
      <nav className="space-y-0.5" aria-label="Agentur">
        <Link href="/" className={item}><LayoutDashboard size={18} aria-hidden /> Übersicht</Link>
        <Link href="/freigaben" className={item}>
          <Inbox size={18} aria-hidden /> Freigaben
          {pendingApprovals > 0 && (
            <span className="ml-auto rounded-full bg-amber-700 px-2 py-0.5 text-xs font-semibold text-white" aria-label={`${pendingApprovals} offen`}>
              {pendingApprovals}
            </span>
          )}
        </Link>
        <Link href="/analytics" className={item}><BarChart3 size={18} aria-hidden /> Analytics</Link>
        {isAgencyStaff(user) && <Link href="/souveraenitaet" className={item}><ShieldCheck size={18} aria-hidden /> Souveränität &amp; Pflichten</Link>}
        {isAgencyStaff(user) && <Link href="/kosten" className={item}><Gauge size={18} aria-hidden /> Nutzung &amp; Kosten</Link>}
        {isAgencyStaff(user) && <Link href="/benutzer" className={item}><Users size={18} aria-hidden /> Benutzer</Link>}
      </nav>
      <div className="mt-6 mb-2 px-2.5 text-xs font-semibold uppercase tracking-wider text-ink-400">Sub-Accounts</div>
      <nav className="space-y-0.5 overflow-y-auto" aria-label="Sub-Accounts">
        {workspaces.map((w) => (
          <Link key={w.id} href={`/sa/${w.slug}`} className={item}>
            <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: w.brandPrimary }} aria-hidden />
            {w.name}
            {unreadOf(w.id) > 0 && (
              <span className="ml-auto rounded-full bg-accent-600 px-2 py-0.5 text-xs font-semibold text-white" aria-label={`${unreadOf(w.id)} ungelesene Gespräche`} title="Ungelesen im Posteingang">
                {unreadOf(w.id)}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <div className="mt-auto space-y-0.5 border-t border-ink-100 pt-3 dark:border-white/10">
        <Link href="/konto" className={item}><UserRound size={18} aria-hidden /> {user.name}</Link>
        <form action={logout}>
          <button className={`${item} w-full`}><LogOut size={18} aria-hidden /> Abmelden</button>
        </form>
      </div>
      </SidebarMenu>
    </aside>
  );
}
