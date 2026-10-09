import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { contactName } from "@/lib/a-format";
import { btnCls, btnGhostCls, Card, Empty, inputCls, PageHeader } from "@/components/ui";
import { createTask, deleteTask, toggleTask } from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  ["heute", "Heute"],
  ["ueberfaellig", "Überfällig"],
  ["kommend", "Kommend"],
  ["erledigt", "Erledigt"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS.find(([k]) => k === rawTab)?.[0] ?? "heute") as Tab;
  const { ws, access } = await pageAccess(slug);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 3600 * 1000);

  const filters: Record<Tab, Prisma.TaskWhereInput> = {
    heute: { doneAt: null, dueAt: { gte: startOfDay, lt: endOfDay } },
    ueberfaellig: { doneAt: null, dueAt: { lt: startOfDay } },
    kommend: { doneAt: null, OR: [{ dueAt: { gte: endOfDay } }, { dueAt: null }] },
    erledigt: { doneAt: { not: null } },
  };

  const [tasks, counts, contacts] = await Promise.all([
    db.task.findMany({
      where: withScope({ workspaceId: ws.id, ...filters[tab] }, access, "tasks"),
      include: { contact: true },
      orderBy: tab === "erledigt" ? { doneAt: "desc" } : { dueAt: { sort: "asc", nulls: "last" } },
      take: 200,
    }),
    Promise.all(TABS.map(([k]) => db.task.count({ where: withScope({ workspaceId: ws.id, ...filters[k] }, access, "tasks") }))),
    db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), orderBy: { createdAt: "desc" }, take: 500, select: { id: true, firstName: true, lastName: true, email: true } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Aufgaben" />
      <div className="flex gap-1">
        {TABS.map(([k, label], i) => (
          <Link
            key={k}
            href={`/sa/${slug}/aufgaben?tab=${k}`}
            className={`${btnGhostCls} ${tab === k ? "bg-black/5 font-semibold dark:bg-white/10" : ""} ${k === "ueberfaellig" && counts[i] > 0 ? "text-red-600" : ""}`}
          >
            {label} ({counts[i]})
          </Link>
        ))}
      </div>

      <Card>
        {tasks.length === 0 ? <Empty>Keine Aufgaben in dieser Ansicht.</Empty> : (
          <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <form action={toggleTask.bind(null, slug, t.id)}>
                  <button
                    disabled={!can(access, "tasks", "edit", t.ownerId)}
                    title={t.doneAt ? "Wieder öffnen" : "Erledigt"}
                    aria-label={t.doneAt ? `„${t.title}“ wieder öffnen` : `„${t.title}“ als erledigt markieren`}
                    className={`h-4 w-4 rounded border disabled:opacity-40 ${t.doneAt ? "border-green-600 bg-green-600" : "border-black/30 dark:border-white/30"}`}
                  />
                </form>
                <span className={`flex-1 ${t.doneAt ? "text-ink-400 line-through" : ""}`}>{t.title}</span>
                {t.contact && (
                  <Link href={`/sa/${slug}/kontakte/${t.contact.id}`} className="text-xs text-ink-400 dark:text-ink-200 hover:underline">{contactName(t.contact)}</Link>
                )}
                <span className={`w-36 text-right text-xs ${!t.doneAt && t.dueAt && t.dueAt < now ? "text-red-600" : "text-ink-400 dark:text-ink-200"}`}>
                  {t.dueAt ? formatDate(t.dueAt, true) : "ohne Termin"}
                </span>
                {can(access, "tasks", "delete", t.ownerId) && (
                  <form action={deleteTask.bind(null, slug, t.id)}>
                    <button className="text-xs text-ink-400 hover:text-red-600" title="Löschen" aria-label={`„${t.title}“ löschen`}>✕</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {can(access, "tasks", "edit") && (
      <Card title="Aufgabe anlegen">
        <form action={createTask.bind(null, slug)} className="grid gap-2 md:grid-cols-4">
          <input name="title" required placeholder="Was ist zu tun?" className={`${inputCls} md:col-span-2`} />
          <input name="dueAt" type="datetime-local" className={inputCls} aria-label="Fällig am" />
          <select name="contactId" defaultValue="" className={inputCls} aria-label="Kontakt">
            <option value="">Ohne Kontakt</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
          </select>
          <div><button className={btnCls}>Anlegen</button></div>
        </form>
      </Card>
      )}
    </div>
  );
}
