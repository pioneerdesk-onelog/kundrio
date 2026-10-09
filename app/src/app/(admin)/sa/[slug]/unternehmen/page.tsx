import { formatNumber } from "@/lib/workspace";
import Link from "next/link";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { canSetOwner } from "@/lib/permissions/rules";
import { lifecycleStages, ownerOptions } from "@/lib/objects/defaults";
import { stageLabel } from "@/lib/objects/lifecycle";
import { PROPERTY_TYPES } from "@/lib/properties";
import { Badge, btnCls, Card, Empty, inputCls, labelCls, PageHeader } from "@/components/ui";
import { Flash } from "@/components/b/Flash";
import { createCompany, createCompanyField } from "./actions";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { text: "Text", number: "Zahl", date: "Datum", boolean: "Ja/Nein", select: "Auswahl" };

export default async function CompaniesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; ok?: string; fehler?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const mayCreate = can(access, "companies", "edit");
  const mayFields = can(access, "lists", "edit");
  const q = (sp.q ?? "").trim().slice(0, 100);
  const where = {
    workspaceId: ws.id,
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { domain: { contains: q.toLowerCase() } }, { industry: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const [companies, total, stages, owners, fields] = await Promise.all([
    db.company.findMany({
      where: withScope(where, access, "companies"),
      orderBy: { name: "asc" },
      take: 200,
      include: { owner: { select: { name: true } }, _count: { select: { contacts: true, deals: true, tickets: true } } },
    }),
    db.company.count({ where: withScope(where, access, "companies") }),
    lifecycleStages(ws.id),
    ownerOptions(ws.id),
    db.propertyDefinition.findMany({ where: { workspaceId: ws.id, objectType: "company" }, orderBy: { label: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Unternehmen" description="Firmen mit verknüpften Kontakten, Deals und Tickets. Kontakte mit Firmen-E-Mail werden automatisch per Domain zugeordnet (Freemail ausgenommen)." />
      <Flash ok={sp.ok} fehler={sp.fehler} />

      <form className="flex gap-2" role="search">
        <label className="sr-only" htmlFor="q">Suche</label>
        <input id="q" name="q" defaultValue={q} placeholder="Name, Domain oder Branche suchen" className={inputCls} />
        <button className={btnCls}>Suchen</button>
      </form>

      <Card title={`${formatNumber(total)} Unternehmen${total > companies.length ? ` (die ersten ${formatNumber(companies.length)})` : ""}`}>
        {companies.length === 0 ? <Empty>Noch keine Unternehmen.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead className="text-left text-sm text-ink-400 dark:text-ink-200">
                <tr><th className="py-2 pr-3 font-medium">Name</th><th className="pr-3 font-medium">Domain</th><th className="pr-3 font-medium">Phase</th><th className="pr-3 font-medium">Zuständig</th><th className="pr-3 text-right font-medium">Kontakte</th><th className="pr-3 text-right font-medium">Deals</th><th className="text-right font-medium">Tickets</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-white/10">
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3"><Link href={`/sa/${slug}/unternehmen/${c.id}`} className="font-medium hover:underline">{c.name}</Link>{c.industry && <span className="ml-2 text-sm text-ink-400">{c.industry}</span>}</td>
                    <td className="pr-3 text-ink-600 dark:text-ink-200">{c.domain ?? "–"}</td>
                    <td className="pr-3">{c.lifecycleStage ? <Badge tone="accent">{stageLabel(stages, c.lifecycleStage)}</Badge> : "–"}</td>
                    <td className="pr-3">{c.owner?.name ?? "–"}</td>
                    <td className="pr-3 text-right tabular-nums">{c._count.contacts}</td>
                    <td className="pr-3 text-right tabular-nums">{c._count.deals}</td>
                    <td className="text-right tabular-nums">{c._count.tickets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(mayCreate || mayFields) && (
      <div className="grid gap-4 lg:grid-cols-2">
        {mayCreate && (
        <Card title="Unternehmen anlegen">
          <form action={createCompany.bind(null, slug)} className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className={labelCls}>Name *</span><input name="name" required maxLength={200} className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Domain</span><input name="domain" placeholder="firma.de" className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Branche</span><input name="industry" className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Lifecycle-Phase</span>
              <select name="lifecycleStage" defaultValue="" className={inputCls}><option value="">–</option>{stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            </label>
            <label className="block"><span className={labelCls}>Zuständig</span>
              <select name="ownerId" defaultValue="" className={inputCls}><option value="">–</option>{owners.filter((o) => canSetOwner(access.perms, "companies", { userId: access.userId, teamUserIds: access.teamUserIds }, o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            </label>
            <div className="sm:col-span-2"><button className={btnCls}>Anlegen</button></div>
          </form>
        </Card>
        )}

        {mayFields && (
        <Card title="Eigene Felder für Unternehmen">
          {fields.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-2">{fields.map((f) => <li key={f.id}><Badge>{f.label} · {TYPE_LABEL[f.type] ?? f.type}</Badge></li>)}</ul>
          )}
          <form action={createCompanyField.bind(null, slug)} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="back" value={`/sa/${slug}/unternehmen`} />
            <label className="block"><span className={labelCls}>Bezeichnung</span><input name="label" required className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Schlüssel</span><input name="key" required placeholder="MITARBEITER" className={`${inputCls} font-mono`} /></label>
            <label className="block"><span className={labelCls}>Typ</span>
              <select name="type" className={inputCls}>{PROPERTY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
            </label>
            <div className="sm:col-span-3"><button className={btnCls}>Feld anlegen</button></div>
          </form>
        </Card>
        )}
      </div>
      )}
    </div>
  );
}
