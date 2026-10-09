import Link from "next/link";
import { ScheduleMeetingButton } from "@/components/calendar/ScheduleMeetingButton";
import { ProcessCard } from "@/components/process/ProcessCard";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { canSetOwner } from "@/lib/permissions/rules";
import { contactName } from "@/lib/a-format";
import { ownerOptions } from "@/lib/objects/defaults";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/objects/lifecycle";
import { Badge, btnCls, btnDangerCls, btnGhostCls, Card, Empty, inputCls, labelCls, PageHeader } from "@/components/ui";
import { Flash } from "@/components/b/Flash";
import { addTicketNote, changeTicketStage, deleteTicket, updateTicket } from "../actions";

export const dynamic = "force-dynamic";

export default async function TicketDetail({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ ok?: string; fehler?: string }> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const t = await db.ticket.findFirst({
    where: { id, workspaceId: ws.id },
    include: { stage: true, contact: true, company: true, owner: { select: { name: true } }, pipeline: { include: { stages: { orderBy: { position: "asc" } } } } },
  });
  if (!t || !can(access, "tickets", "read", t.ownerId)) notFound();
  const mayEdit = can(access, "tickets", "edit", t.ownerId);
  const mayDelete = can(access, "tickets", "delete", t.ownerId);
  const ownerCtx = { userId: access.userId, teamUserIds: access.teamUserIds };
  const [owners, contacts, companies, notes] = await Promise.all([
    ownerOptions(ws.id),
    db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), orderBy: { createdAt: "desc" }, take: 500, select: { id: true, firstName: true, lastName: true, email: true } }),
    db.company.findMany({ where: withScope({ workspaceId: ws.id }, access, "companies"), orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }),
    db.activity.findMany({ where: { workspaceId: ws.id, meta: { path: ["ticketId"], equals: t.id } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const late = !t.closedAt && t.slaDueAt && t.slaDueAt < new Date();

  return (
    <div className="space-y-6">
      <PageHeader title={`#${t.numericId} ${t.subject}`} description={`${t.pipeline.name} · Quelle: ${t.source}`}>
        <Badge tone={t.closedAt ? "ok" : "accent"}>{t.stage.name}</Badge>
        {late && <Badge tone="bad">SLA überschritten</Badge>}
        <Link href={`/sa/${slug}/tickets?ansicht=liste`} className={btnGhostCls}>Zurück</Link>
        <ScheduleMeetingButton slug={slug} workspaceId={ws.id} contactIds={t.contactId ? [t.contactId] : []} />
      </PageHeader>
      <Flash ok={sp.ok} fehler={sp.fehler} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Status">
            {mayEdit && <form action={changeTicketStage.bind(null, slug, t.id)} className="flex gap-2">
              <label className="sr-only" htmlFor="stageId">Status</label>
              <select id="stageId" name="stageId" defaultValue={t.stageId} className={inputCls}>{t.pipeline.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <button className={btnGhostCls}>Setzen</button>
            </form>}
            <dl className="mt-3 space-y-1 text-sm text-ink-600 dark:text-ink-200">
              <div>Angelegt: {formatDate(t.createdAt, true)}</div>
              <div>SLA-Frist: {formatDate(t.slaDueAt, true)}</div>
              <div>Erste Reaktion: {formatDate(t.firstResponseAt, true)}</div>
              <div>Geschlossen: {formatDate(t.closedAt, true)}</div>
              {t.externalRef && <div>Herkunft: {t.externalRef}</div>}
            </dl>
          </Card>
          <Card title="Bezüge">
            <ul className="space-y-1 text-[15px]">
              <li>Kontakt: {t.contact ? <Link href={`/sa/${slug}/kontakte/${t.contact.id}`} className="underline">{contactName(t.contact)}</Link> : "–"}</li>
              <li>Unternehmen: {t.company ? <Link href={`/sa/${slug}/unternehmen/${t.company.id}`} className="underline">{t.company.name}</Link> : "–"}</li>
              <li>Zuständig: {t.owner?.name ?? "–"}</li>
            </ul>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          {mayEdit && (
          <Card title="Ticket bearbeiten">
            <form action={updateTicket.bind(null, slug, t.id)} className="grid gap-3 md:grid-cols-3">
              <label className="block md:col-span-2"><span className={labelCls}>Betreff *</span><input name="subject" required defaultValue={t.subject} className={inputCls} /></label>
              <label className="block"><span className={labelCls}>Priorität</span>
                <select name="priority" defaultValue={t.priority} className={inputCls}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
              </label>
              <label className="block md:col-span-3"><span className={labelCls}>Beschreibung</span><textarea name="description" rows={5} defaultValue={t.description ?? ""} className={inputCls} /></label>
              <label className="block"><span className={labelCls}>Kontakt</span>
                <select name="contactId" defaultValue={t.contactId ?? ""} className={inputCls}><option value="">–</option>{contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}</select>
              </label>
              <label className="block"><span className={labelCls}>Unternehmen</span>
                <select name="companyId" defaultValue={t.companyId ?? ""} className={inputCls}><option value="">–</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </label>
              <label className="block"><span className={labelCls}>Zuständig</span>
                <select name="ownerId" defaultValue={t.ownerId ?? ""} className={inputCls}><option value="">–</option>{owners.filter((o) => o.id === t.ownerId || canSetOwner(access.perms, "tickets", ownerCtx, o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
              </label>
              <div><button className={btnCls}>Speichern</button></div>
            </form>
          </Card>
          )}

          <Card title="Notizen">
            {mayEdit && <form action={addTicketNote.bind(null, slug, t.id)} className="mb-4 space-y-2">
              <label className="sr-only" htmlFor="body">Notiz</label>
              <textarea id="body" name="body" required rows={2} placeholder="Was wurde getan oder vereinbart?" className={inputCls} />
              <button className={btnGhostCls}>Notiz speichern</button>
            </form>}
            {notes.length === 0 ? <Empty>Noch keine Notizen.</Empty> : (
              <ol className="space-y-3 text-[15px]">
                {notes.map((n) => (
                  <li key={n.id} className="border-l-2 border-ink-100 pl-3 dark:border-white/10">
                    <div className="text-sm text-ink-400">{formatDate(n.createdAt, true)}</div>
                    <div className="whitespace-pre-wrap">{n.body}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {mayDelete && <form action={deleteTicket.bind(null, slug, t.id)}><button className={btnDangerCls}>Ticket löschen</button></form>}
        </div>
      </div>
      <ProcessCard slug={slug} workspaceId={ws.id} objectType="ticket" objectId={t.id} access={access} />
    </div>
  );
}
