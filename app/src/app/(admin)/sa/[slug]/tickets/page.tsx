import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { canSetOwner } from "@/lib/permissions/rules";
import { contactName } from "@/lib/a-format";
import { ownerOptions } from "@/lib/objects/defaults";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/objects/lifecycle";
import { defaultTicketPipeline } from "@/lib/objects/tickets";
import { Badge, btnCls, btnGhostCls, Card, Empty, inputCls, labelCls, PageHeader } from "@/components/ui";
import { Flash } from "@/components/b/Flash";
import { Kanban } from "@/components/a/Kanban";
import { createTicket, moveTicket } from "./actions";

export const dynamic = "force-dynamic";

const PRIO_TONE = { low: "neutral", medium: "accent", high: "warn", urgent: "bad" } as const;

type SP = { ansicht?: string; prio?: string; owner?: string; sla?: string; offen?: string; ok?: string; fehler?: string };

export default async function TicketsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const mayCreate = can(access, "tickets", "edit");
  const pipeline = await defaultTicketPipeline(ws.id);
  const now = new Date();
  const list = sp.ansicht === "liste";

  const where: Prisma.TicketWhereInput = { workspaceId: ws.id, pipelineId: pipeline.id };
  if (sp.prio && (PRIORITIES as readonly string[]).includes(sp.prio)) where.priority = sp.prio;
  if (sp.owner === "none") where.ownerId = null;
  else if (sp.owner) where.ownerId = sp.owner;
  if (sp.sla === "ueberfaellig") Object.assign(where, { slaDueAt: { lt: now }, closedAt: null });
  if (sp.offen === "1") where.closedAt = null;

  const [tickets, owners, contacts, companies] = await Promise.all([
    db.ticket.findMany({ where: withScope(where, access, "tickets"), orderBy: [{ closedAt: "asc" }, { slaDueAt: "asc" }, { createdAt: "desc" }], take: 500, include: { contact: true, company: { select: { name: true } }, owner: { select: { name: true } }, stage: true } }),
    ownerOptions(ws.id),
    db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), orderBy: { createdAt: "desc" }, take: 500, select: { id: true, firstName: true, lastName: true, email: true } }),
    db.company.findMany({ where: withScope({ workspaceId: ws.id }, access, "companies"), orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }),
  ]);
  const overdue = tickets.filter((t) => !t.closedAt && t.slaDueAt && t.slaDueAt < now).length;
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ok: undefined, fehler: undefined, ...patch }).filter(([, v]) => v) as [string, string][]);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-6">
      <PageHeader title={`Tickets · ${pipeline.name}`} description={`${tickets.filter((t) => !t.closedAt).length} offen${overdue ? ` · ${overdue} mit überschrittener SLA-Frist` : ""}`}>
        <Link href={qs({ ansicht: list ? undefined : "liste" })} className={btnGhostCls}>{list ? "Kanban" : "Liste"}</Link>
      </PageHeader>
      <Flash ok={sp.ok} fehler={sp.fehler} />

      <form className="flex flex-wrap items-end gap-3" aria-label="Filter">
        {list && <input type="hidden" name="ansicht" value="liste" />}
        <label className="block"><span className={labelCls}>Priorität</span>
          <select name="prio" defaultValue={sp.prio ?? ""} className={inputCls}><option value="">alle</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
        </label>
        <label className="block"><span className={labelCls}>Zuständig</span>
          <select name="owner" defaultValue={sp.owner ?? ""} className={inputCls}><option value="">alle</option><option value="none">niemand</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-[15px]"><input type="checkbox" name="sla" value="ueberfaellig" defaultChecked={sp.sla === "ueberfaellig"} /> SLA überschritten</label>
        <label className="flex items-center gap-2 pb-2 text-[15px]"><input type="checkbox" name="offen" value="1" defaultChecked={sp.offen === "1"} /> nur offene</label>
        <button className={btnGhostCls}>Filtern</button>
      </form>

      {list ? (
        <Card>
          {tickets.length === 0 ? <Empty>Keine Tickets.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="text-left text-sm text-ink-400 dark:text-ink-200"><tr><th className="py-2 pr-3 font-medium">Ticket</th><th className="pr-3 font-medium">Status</th><th className="pr-3 font-medium">Priorität</th><th className="pr-3 font-medium">Kontakt / Firma</th><th className="pr-3 font-medium">Zuständig</th><th className="font-medium">SLA-Frist</th></tr></thead>
                <tbody className="divide-y divide-ink-100 dark:divide-white/10">
                  {tickets.map((t) => {
                    const late = !t.closedAt && t.slaDueAt && t.slaDueAt < now;
                    return (
                      <tr key={t.id}>
                        <td className="py-2 pr-3"><Link href={`/sa/${slug}/tickets/${t.id}`} className="font-medium hover:underline">#{t.numericId} {t.subject}</Link></td>
                        <td className="pr-3">{t.stage.name}</td>
                        <td className="pr-3"><Badge tone={PRIO_TONE[t.priority as keyof typeof PRIO_TONE] ?? "neutral"}>{PRIORITY_LABEL[t.priority] ?? t.priority}</Badge></td>
                        <td className="pr-3">{t.contact ? contactName(t.contact) : "–"}{t.company && <span className="text-sm text-ink-400"> · {t.company.name}</span>}</td>
                        <td className="pr-3">{t.owner?.name ?? "–"}</td>
                        <td className={late ? "font-semibold text-red-700 dark:text-red-300" : ""}>{t.closedAt ? "erledigt" : formatDate(t.slaDueAt, true)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <>
          <Kanban
            key={tickets.map((t) => `${t.id}:${t.stageId}`).join(",")}
            stages={pipeline.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))}
            deals={tickets.map((t) => ({
              id: t.id,
              stageId: t.stageId,
              title: `#${t.numericId} ${t.subject}`,
              value: PRIORITY_LABEL[t.priority] ?? t.priority,
              contact: t.contact ? contactName(t.contact) : t.company?.name ?? null,
              lostReason: !t.closedAt && t.slaDueAt && t.slaDueAt < now ? "SLA-Frist überschritten" : null,
              movable: can(access, "tickets", "edit", t.ownerId),
            }))}
            onMove={moveTicket.bind(null, slug)}
          />
          <p className="text-sm text-ink-400">Karten per Ziehen verschieben. Details über die Listenansicht öffnen.</p>
        </>
      )}

      {mayCreate && (
      <Card title="Ticket anlegen">
        <form action={createTicket.bind(null, slug)} className="grid gap-3 md:grid-cols-3">
          <label className="block md:col-span-2"><span className={labelCls}>Betreff *</span><input name="subject" required maxLength={300} className={inputCls} /></label>
          <label className="block"><span className={labelCls}>Priorität</span>
            <select name="priority" defaultValue="medium" className={inputCls}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
          </label>
          <label className="block md:col-span-3"><span className={labelCls}>Beschreibung</span><textarea name="description" rows={3} className={inputCls} /></label>
          <label className="block"><span className={labelCls}>Kontakt</span>
            <select name="contactId" defaultValue="" className={inputCls}><option value="">–</option>{contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}</select>
          </label>
          <label className="block"><span className={labelCls}>Unternehmen</span>
            <select name="companyId" defaultValue="" className={inputCls}><option value="">vom Kontakt</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="block"><span className={labelCls}>Zuständig</span>
            <select name="ownerId" defaultValue="" className={inputCls}><option value="">–</option>{owners.filter((o) => canSetOwner(access.perms, "tickets", { userId: access.userId, teamUserIds: access.teamUserIds }, o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          </label>
          <p className="text-sm text-ink-400 md:col-span-2">SLA-Frist nach Priorität: Dringend 4 h, Hoch 8 h, Mittel 24 h, Niedrig 72 h.</p>
          <div><button className={btnCls}>Anlegen</button></div>
        </form>
      </Card>
      )}
    </div>
  );
}
