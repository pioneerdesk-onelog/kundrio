import { formatNumber } from "@/lib/workspace";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { contactName } from "@/lib/a-format";
import { btnCls, btnDangerCls, btnGhostCls, Card, Empty, inputCls, labelCls, PageHeader } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";
import { addMembers, deleteList, removeMember, renameList } from "../actions";

export const dynamic = "force-dynamic";

export default async function ListDetail({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: FlashParams }) {
  const { slug, id } = await params;
  const { ws, access } = await pageAccess(slug);
  const mayEdit = can(access, "lists", "edit");
  const list = await db.contactList.findFirst({ where: { id, workspaceId: ws.id } });
  if (!list) notFound();
  const [members, total, tagRows] = await Promise.all([
    // Mitglieder nur im Rahmen der Kontakt-Reichweite anzeigen
    db.contactListMember.findMany({ where: { listId: list.id, contact: withScope({}, access, "contacts") }, orderBy: { addedAt: "desc" }, take: 300, include: { contact: true } }),
    db.contactListMember.count({ where: { listId: list.id } }),
    db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), select: { tags: true } }),
  ]);
  const tags = Array.from(new Set(tagRows.flatMap((r) => r.tags))).sort();

  return (
    <div className="space-y-6">
      <PageHeader title={list.name} description={`Listen-ID #${list.numericId} · ${formatNumber(total)} Mitglieder${list.source ? ` · Herkunft: ${list.source}` : ""}`}>
        <Link href={`/sa/${slug}/listen`} className={btnGhostCls}>Zurück</Link>
      </PageHeader>
      <Flash {...await searchParams} />

      <div className="grid gap-4 lg:grid-cols-3">
        {mayEdit && <div className="space-y-4">
          <Card title="Mitglieder hinzufügen">
            <form action={addMembers.bind(null, slug, list.id)} className="space-y-2">
              <input type="hidden" name="mode" value="emails" />
              <label className="block"><span className={labelCls}>E-Mail-Adressen (vorhandene Kontakte)</span>
                <textarea name="emails" rows={4} className={inputCls} placeholder="eine pro Zeile" /></label>
              <button className={btnCls}>Hinzufügen</button>
            </form>
            {tags.length > 0 && (
              <form action={addMembers.bind(null, slug, list.id)} className="mt-4 flex flex-wrap items-end gap-2">
                <input type="hidden" name="mode" value="tag" />
                <label className="flex-1"><span className={labelCls}>Alle mit Tag</span>
                  <select name="tag" className={inputCls}>{tags.map((t) => <option key={t}>{t}</option>)}</select></label>
                <button className={btnGhostCls}>Hinzufügen</button>
              </form>
            )}
            <form action={addMembers.bind(null, slug, list.id)} className="mt-4">
              <input type="hidden" name="mode" value="all" />
              <button className={btnGhostCls}>Alle Kontakte hinzufügen</button>
            </form>
          </Card>
          <Card title="Liste verwalten">
            <form action={renameList.bind(null, slug, list.id)} className="flex gap-2">
              <label className="sr-only" htmlFor="rename">Neuer Name</label>
              <input id="rename" name="name" defaultValue={list.name} required maxLength={120} className={inputCls} />
              <button className={btnGhostCls}>Umbenennen</button>
            </form>
            {can(access, "lists", "delete") && (
              <form action={deleteList.bind(null, slug, list.id)} className="mt-3">
                <button className={btnDangerCls}>Liste löschen</button>
                <p className="mt-1 text-sm text-ink-400">Kontakte bleiben erhalten, nur die Zuordnung entfällt.</p>
              </form>
            )}
          </Card>
        </div>}

        <Card title={`Mitglieder (${formatNumber(total)})`} className="lg:col-span-2">
          {members.length === 0 ? <Empty>Noch keine Mitglieder.</Empty> : (
            <ul className="divide-y divide-ink-100 dark:divide-white/10">
              {members.map((m) => (
                <li key={m.contactId} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <Link href={`/sa/${slug}/kontakte/${m.contactId}`} className="font-medium hover:underline">{contactName(m.contact)}</Link>
                    <span className="ml-2 text-sm text-ink-400">{m.contact.email}</span>
                    {m.contact.unsubscribedAt && <span className="ml-2 text-sm text-red-700 dark:text-red-300">abgemeldet</span>}
                  </div>
                  {mayEdit && (
                    <form action={removeMember.bind(null, slug, list.id, m.contactId)}>
                      <button className="text-sm text-ink-600 hover:text-red-700 hover:underline dark:text-ink-200">Entfernen</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {total > members.length && <p className="mt-2 text-sm text-ink-400">Es werden die neuesten {members.length} angezeigt.</p>}
        </Card>
      </div>
    </div>
  );
}
