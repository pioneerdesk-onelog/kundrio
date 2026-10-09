import { db } from "@/lib/db";
import { formatEuro } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { canSetOwner } from "@/lib/permissions/rules";
import { contactName } from "@/lib/a-format";
import { btnCls, Card, Empty, inputCls, PageHeader } from "@/components/ui";
import { Kanban } from "@/components/a/Kanban";
import { createDeal, moveDeal } from "./actions";
import { ownerOptions } from "@/lib/objects/defaults";
import { BOARD_STAGE_LIMIT, boardColumns } from "@/lib/objects/board";

export const dynamic = "force-dynamic";

export default async function PipelinePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const mayCreate = can(access, "deals", "edit");
  const pipeline = await db.pipeline.findFirst({
    where: { workspaceId: ws.id, objectType: "deal" },
    orderBy: { createdAt: "asc" },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!pipeline) return <Empty>Für diesen Sub-Account gibt es noch keine Pipeline.</Empty>;

  // Je Spalte höchstens BOARD_STAGE_LIMIT Karten (zuletzt hinzugefügt/verschoben); Summe und Anzahl per Aggregat (LR-3)
  const dealWhere = withScope({ workspaceId: ws.id, pipelineId: pipeline.id }, access, "deals");
  const openStageIds = pipeline.stages.filter((s) => s.kind === "OPEN").map((s) => s.id);
  const [perStage, totals, openAgg, contacts, companies, owners] = await Promise.all([
    Promise.all(
      pipeline.stages.map((s) =>
        db.deal.findMany({
          where: { AND: [dealWhere, { stageId: s.id }] },
          include: { contact: { select: { firstName: true, lastName: true, email: true } } },
          orderBy: { position: "desc" },
          take: BOARD_STAGE_LIMIT,
        }),
      ),
    ),
    db.deal.groupBy({ by: ["stageId"], where: dealWhere, _count: { _all: true } }),
    db.deal.aggregate({ where: { AND: [dealWhere, { stageId: { in: openStageIds } }] }, _sum: { valueCents: true } }),
    db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), orderBy: { createdAt: "desc" }, take: 500, select: { id: true, firstName: true, lastName: true, email: true } }),
    db.company.findMany({ where: withScope({ workspaceId: ws.id }, access, "companies"), orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }),
    ownerOptions(ws.id),
  ]);
  const { deals, hidden } = boardColumns(
    pipeline.stages.map((s) => s.id),
    Object.fromEntries(pipeline.stages.map((s, i) => [s.id, perStage[i]])),
    totals.map((t) => ({ stageId: t.stageId, count: t._count._all })),
  );
  const openSum = openAgg._sum.valueCents ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title={`Pipeline „${pipeline.name}“ · offen ${formatEuro(openSum)}`} />
      <Kanban
        key={deals.map((d) => `${d.id}:${d.stageId}`).join(",")}
        stages={pipeline.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))}
        deals={deals.map((d) => ({
          id: d.id,
          stageId: d.stageId,
          title: d.title,
          value: formatEuro(d.valueCents),
          contact: d.contact ? contactName(d.contact) : null,
          lostReason: d.lostReason,
          movable: can(access, "deals", "edit", d.ownerId),
          href: `/sa/${slug}/pipeline/${d.id}`,
        }))}
        hidden={hidden}
        onMove={moveDeal.bind(null, slug)}
      />
      {mayCreate && (
      <Card title="Deal anlegen">
        <form action={createDeal.bind(null, slug)} className="grid gap-2 md:grid-cols-4">
          <input name="title" required placeholder="Titel" className={`${inputCls} md:col-span-2`} />
          <input name="value" inputMode="decimal" placeholder="Wert in €" className={inputCls} />
          <select name="contactId" className={inputCls} defaultValue="" aria-label="Kontakt">
            <option value="">Ohne Kontakt</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
          </select>
          <select name="companyId" className={inputCls} defaultValue="" aria-label="Unternehmen">
            <option value="">Unternehmen vom Kontakt</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="ownerId" className={inputCls} defaultValue="" aria-label="Zuständig">
            <option value="">Niemand zuständig</option>
            {owners.filter((o) => canSetOwner(access.perms, "deals", { userId: access.userId, teamUserIds: access.teamUserIds }, o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select name="stageId" className={inputCls} defaultValue={pipeline.stages[0]?.id} aria-label="Phase">
            {pipeline.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div><button className={btnCls}>Anlegen</button></div>
        </form>
      </Card>
      )}
    </div>
  );
}
