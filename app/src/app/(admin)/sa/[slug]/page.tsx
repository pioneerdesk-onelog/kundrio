import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate, formatEuro } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { Card, Empty, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SubAccountDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const now = new Date();
  // Kennzahlen nur im Rahmen der eigenen Rechte und Reichweite
  const seeContacts = can(access, "contacts", "read");
  const seeDeals = can(access, "deals", "read");
  const seeTasks = can(access, "tasks", "read");
  const [contacts, open, tasks, activities] = await Promise.all([
    seeContacts ? db.contact.count({ where: withScope({ workspaceId: ws.id }, access, "contacts") }) : 0,
    seeDeals
      ? db.deal.aggregate({ where: withScope({ workspaceId: ws.id, stage: { kind: "OPEN" as const } }, access, "deals"), _sum: { valueCents: true }, _count: true })
      : { _sum: { valueCents: 0 }, _count: 0 },
    seeTasks ? db.task.findMany({ where: withScope({ workspaceId: ws.id, doneAt: null }, access, "tasks"), orderBy: { dueAt: "asc" }, take: 8 }) : [],
    seeContacts
      ? db.activity.findMany({ where: { workspaceId: ws.id, contactId: { not: null }, contact: withScope({}, access, "contacts") }, orderBy: { createdAt: "desc" }, take: 10, include: { contact: true } })
      : [],
  ]);
  const overdue = tasks.filter((t) => t.dueAt && t.dueAt <= now).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Kontakte" value={contacts} />
        <Stat label="Offene Deals" value={open._count} />
        <Stat label="Pipeline-Wert" value={formatEuro(open._sum.valueCents ?? 0)} />
        <Stat label="Überfällige Aufgaben" value={overdue} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Offene Aufgaben">
          {tasks.length === 0 ? <Empty>Keine offenen Aufgaben.</Empty> : (
            <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
              {tasks.map((t) => (
                <li key={t.id} className="flex justify-between py-1.5">
                  <span>{t.title}</span>
                  <span className={t.dueAt && t.dueAt <= now ? "text-red-600" : "text-ink-400 dark:text-ink-200"}>{formatDate(t.dueAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Letzte Aktivitäten">
          {activities.length === 0 ? <Empty>Noch keine Aktivitäten.</Empty> : (
            <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
              {activities.map((a) => (
                <li key={a.id} className="py-1.5">
                  <span className="text-ink-400 dark:text-ink-200">{formatDate(a.createdAt, true)} · </span>
                  {a.contact && (
                    <Link className="hover:underline" href={`/sa/${slug}/kontakte/${a.contact.id}`}>
                      {[a.contact.firstName, a.contact.lastName].filter(Boolean).join(" ") || a.contact.email}:{" "}
                    </Link>
                  )}
                  {a.body}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
