import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, hasSpecial, scopeWhere } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { TOPICS } from "@/lib/research/types";
import { Card, PageHeader, inputCls, btnGhostCls } from "@/components/ui";
import { MentionList, type MentionItem } from "@/components/research/MentionList";
import { MonitoringSettings } from "@/components/research/MonitoringSettings";

export const dynamic = "force-dynamic";

type SP = { thema?: string; ton?: string; firma?: string; status?: string };

// Übersicht aller Presse-/Web-Erwähnungen im Sub-Account (nur Datensätze in der eigenen Reichweite).
export default async function MentionsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);

  // Reichweite „alle“ (z. B. Agentur-Admin) → kein Relationsfilter; ein leeres `company: {}` filterte sonst falsch.
  const allCompanies = access.perms.objects.companies.read === "all";
  const allContacts = access.perms.objects.contacts.read === "all";
  const scoped: Prisma.MentionWhereInput[] = [];
  if (can(access, "companies", "read")) scoped.push(allCompanies ? { companyId: { not: null } } : { company: scopeWhere(access, "companies") as Prisma.CompanyWhereInput });
  if (can(access, "contacts", "read")) scoped.push(allContacts ? { contactId: { not: null } } : { contact: scopeWhere(access, "contacts") as Prisma.ContactWhereInput });
  // Erwähnungen ohne Firma/Kontakt (Marke des Sub-Accounts) sieht, wer beide Bereiche komplett lesen darf
  if (allCompanies && allContacts) scoped.push({ companyId: null, contactId: null });

  const where: Prisma.MentionWhereInput = {
    workspaceId: ws.id,
    ...(allCompanies && allContacts ? {} : { OR: scoped.length ? scoped : [{ id: "__none__" }] }),
    ...(sp.thema && (TOPICS as readonly string[]).includes(sp.thema) ? { topics: { has: sp.thema } } : {}),
    ...(sp.ton && ["positiv", "neutral", "negativ"].includes(sp.ton) ? { sentiment: sp.ton } : {}),
    ...(sp.firma ? { companyId: sp.firma } : {}),
    ...(sp.status && ["new", "relevant", "irrelevant"].includes(sp.status) ? { status: sp.status } : {}),
  };
  const [mentions, companies, counts] = await Promise.all([
    db.mention.findMany({
      where,
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
      include: { company: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true } } },
    }),
    db.company.findMany({ where: { workspaceId: ws.id, mentions: { some: {} }, ...(scopeWhere(access, "companies") as Prisma.CompanyWhereInput) }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    db.mention.groupBy({ by: ["status"], where: { workspaceId: ws.id, ...(where.OR ? { OR: where.OR } : {}) }, _count: true }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  const items: MentionItem[] = mentions.map((m) => ({
    id: m.id,
    url: m.url,
    title: m.title,
    sourceHost: m.sourceHost,
    sourceKind: m.sourceKind,
    publishedAt: m.publishedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    snippet: m.snippet,
    summary: m.summary,
    sentiment: m.sentiment,
    relevance: m.relevance,
    topics: m.topics,
    status: m.status,
    objectLabel: m.company?.name ?? ([m.contact?.firstName, m.contact?.lastName].filter(Boolean).join(" ") || null),
    objectHref: m.company ? `/sa/${slug}/unternehmen/${m.company.id}` : m.contact ? `/sa/${slug}/kontakte/${m.contact.id}` : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Presse & Erwähnungen"
        description={`Artikel und Web-Erwähnungen zu Unternehmen${ws.enrichPersons ? " und (beruflich) Kontakten" : ""}. Neu: ${count("new")} · relevant: ${count("relevant")} · irrelevant: ${count("irrelevant")}.`}
      />

      {hasSpecial(access, "manage_settings") && (
        <Card title="Monitoring">
          <MonitoringSettings slug={slug} enabled={ws.mentionMonitoring} />
        </Card>
      )}

      <Card title="Filter">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Thema</span>
            <select name="thema" defaultValue={sp.thema ?? ""} className={inputCls}>
              <option value="">alle</option>
              {TOPICS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Tonalität</span>
            <select name="ton" defaultValue={sp.ton ?? ""} className={inputCls}>
              <option value="">alle</option>
              <option value="positiv">positiv</option>
              <option value="neutral">neutral</option>
              <option value="negativ">negativ</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Unternehmen</span>
            <select name="firma" defaultValue={sp.firma ?? ""} className={inputCls}>
              <option value="">alle</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Status</span>
            <select name="status" defaultValue={sp.status ?? ""} className={inputCls}>
              <option value="">alle</option>
              <option value="new">neu</option>
              <option value="relevant">relevant</option>
              <option value="irrelevant">irrelevant</option>
            </select>
          </label>
          <button className={btnGhostCls}>Filtern</button>
        </form>
      </Card>

      <Card title={`Erwähnungen (${items.length}${items.length === 200 ? "+" : ""})`}>
        <MentionList slug={slug} items={items} canEdit={can(access, "companies", "edit")} showObject initialStatus={sp.status ? sp.status : "aktiv"} />
      </Card>
    </div>
  );
}
