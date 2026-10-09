import Link from "next/link";
import { ScheduleMeetingButton } from "@/components/calendar/ScheduleMeetingButton";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate, formatEuro } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { contactName } from "@/lib/a-format";
import { Badge, btnGhostCls, Card, PageHeader } from "@/components/ui";
import { ProcessCard } from "@/components/process/ProcessCard";

export const dynamic = "force-dynamic";

/** Deal-Detail: Stammdaten, Verknüpfungen und Prozessläufe (Bearbeiten weiterhin im Kanban). */
export default async function DealDetail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { ws, access } = await pageAccess(slug);
  const d = await db.deal.findFirst({
    where: { id, workspaceId: ws.id },
    include: { stage: true, pipeline: true, contact: true, company: true, owner: { select: { name: true } } },
  });
  if (!d || !can(access, "deals", "read", d.ownerId)) notFound();
  const tone = d.stage.kind === "WON" ? "ok" : d.stage.kind === "LOST" ? "bad" : "accent";

  return (
    <div className="space-y-6">
      <PageHeader title={d.title} description={`${d.pipeline.name} · ${formatEuro(d.valueCents)}`}>
        <Badge tone={tone}>{d.stage.name}</Badge>
        <Link href={`/sa/${slug}/pipeline`} className={btnGhostCls}>
          Zur Pipeline
        </Link>
        <ScheduleMeetingButton slug={slug} workspaceId={ws.id} contactIds={d.contactId ? [d.contactId] : []} dealId={d.id} />
      </PageHeader>
      <Card title="Daten">
        <dl className="grid gap-3 text-[15px] sm:grid-cols-2">
          <div>
            <dt className="text-sm text-ink-400 dark:text-ink-200">Kontakt</dt>
            <dd>{d.contact ? <Link href={`/sa/${slug}/kontakte/${d.contact.id}`} className="hover:underline">{contactName(d.contact)}</Link> : "–"}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-400 dark:text-ink-200">Unternehmen</dt>
            <dd>{d.company ? <Link href={`/sa/${slug}/unternehmen/${d.company.id}`} className="hover:underline">{d.company.name}</Link> : "–"}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-400 dark:text-ink-200">Zuständig</dt>
            <dd>{d.owner?.name ?? "–"}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-400 dark:text-ink-200">Angelegt / geändert</dt>
            <dd>
              {formatDate(d.createdAt)} / {formatDate(d.updatedAt)}
            </dd>
          </div>
          {d.closedAt && (
            <div>
              <dt className="text-sm text-ink-400 dark:text-ink-200">Abgeschlossen</dt>
              <dd>{formatDate(d.closedAt)}</dd>
            </div>
          )}
          {d.lostReason && (
            <div>
              <dt className="text-sm text-ink-400 dark:text-ink-200">Verlustgrund</dt>
              <dd>{d.lostReason}</dd>
            </div>
          )}
        </dl>
      </Card>
      <ProcessCard slug={slug} workspaceId={ws.id} objectType="deal" objectId={d.id} access={access} />
    </div>
  );
}
