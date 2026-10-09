import Link from "next/link";
import { db } from "@/lib/db";
import { pageAccess } from "@/lib/permissions/guard";
import { can, hasSpecial, scopeWhere } from "@/lib/permissions";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { NoAccess } from "@/components/users/NoAccess";
import { StateForm, Submit } from "@/components/users/StateForm";
import { EnrichSettings } from "@/components/enrich/EnrichSettings";
import { fieldLabel } from "@/lib/enrich/suggestions";
import { bulkEnrichCompanies } from "./actions";

export const dynamic = "force-dynamic";

// Übersicht: offene Vorschläge aller Datensätze, Massen-Anreicherung, Datenschutz-Einstellungen.
export default async function AnreicherungPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const canCompanies = can(access, "companies", "read");
  const canContacts = can(access, "contacts", "read");
  if (!canCompanies && !canContacts) return <NoAccess />;

  const [companies, contacts] = await Promise.all([
    canCompanies
      ? db.company.findMany({ where: { AND: [{ workspaceId: ws.id }, scopeWhere(access, "companies", "read") as object] }, select: { id: true, name: true, domain: true, website: true, ownerId: true, enrichedAt: true }, orderBy: { name: "asc" }, take: 300 })
      : [],
    canContacts
      ? db.contact.findMany({ where: { AND: [{ workspaceId: ws.id }, scopeWhere(access, "contacts", "read") as object] }, select: { id: true, firstName: true, lastName: true, email: true }, take: 2000 })
      : [],
  ]);
  const visible = new Map<string, { kind: "company" | "contact"; name: string; href: string }>();
  for (const c of companies) visible.set(`company:${c.id}`, { kind: "company", name: c.name, href: `/sa/${slug}/unternehmen/${c.id}` });
  for (const c of contacts) visible.set(`contact:${c.id}`, { kind: "contact", name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Kontakt", href: `/sa/${slug}/kontakte/${c.id}` });

  const open = await db.enrichmentSuggestion.findMany({ where: { workspaceId: ws.id, status: "proposed" }, orderBy: { createdAt: "desc" }, take: 500 });
  const groups = new Map<string, typeof open>();
  for (const s of open) {
    const key = `${s.objectType}:${s.objectId}`;
    if (!visible.has(key)) continue; // nur Datensätze in der eigenen Reichweite
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const editable = companies.filter((c) => can(access, "companies", "edit", c.ownerId));
  const aiAvg = await db.aiUsageLog.aggregate({ where: { workspaceId: ws.id, purpose: "enrich-profile" }, _avg: { ms: true, tokensIn: true, tokensOut: true }, _count: true });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anreicherung"
        description="Öffentliche Daten aus Firmen-Websites, Impressum und eigener Suchmaschine – als Vorschläge mit Quelle, die Sie prüfen und übernehmen."
      />

      <Card title={`Offene Vorschläge (${[...groups.values()].reduce((a, g) => a + g.length, 0)})`}>
        {groups.size === 0 ? (
          <Empty>Keine offenen Vorschläge.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {[...groups.entries()].map(([key, list]) => {
              const v = visible.get(key)!;
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <Link href={v.href} className="font-medium hover:underline">
                      {v.name}
                    </Link>{" "}
                    <Badge tone="neutral">{v.kind === "company" ? "Unternehmen" : "Kontakt"}</Badge>
                    <div className="text-sm text-ink-400">{Array.from(new Set(list.map((s) => fieldLabel(v.kind, s.field)))).join(" · ")}</div>
                  </div>
                  <Link href={v.href} className="text-sm text-accent-500 hover:underline dark:text-accent-100">
                    {list.length} prüfen →
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editable.length > 0 && (
        <Card title="Mehrere Unternehmen anreichern">
          <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">
            Je Unternehmen werden bis zu 8 Seiten der eigenen Website abgerufen (robots.txt wird beachtet) und ein KI-Profil erstellt.
            {aiAvg._count > 0
              ? ` Bisher im Schnitt ${Math.round((aiAvg._avg.tokensIn ?? 0) + (aiAvg._avg.tokensOut ?? 0))} Tokens und ${((aiAvg._avg.ms ?? 0) / 1000).toFixed(1)} s Rechenzeit je Profil – Kosten siehe „Nutzung & Kosten“.`
              : " Die KI-Kosten erscheinen nach dem ersten Abruf unter „Nutzung & Kosten“."}
          </p>
          <StateForm action={bulkEnrichCompanies.bind(null, slug)}>
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {editable.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="companyId" value={c.id} />
                    <span>{c.name}</span>
                    <span className="text-sm text-ink-400">{c.domain ?? c.website ?? "ohne Domain (Website wird gesucht)"}</span>
                    {c.enrichedAt && <Badge tone="ok">angereichert</Badge>}
                  </label>
                </li>
              ))}
            </ul>
            <Submit>Ausgewählte anreichern</Submit>
          </StateForm>
        </Card>
      )}

      <EnrichSettings slug={slug} workspaceId={ws.id} canManage={hasSpecial(access, "manage_settings")} />
    </div>
  );
}
