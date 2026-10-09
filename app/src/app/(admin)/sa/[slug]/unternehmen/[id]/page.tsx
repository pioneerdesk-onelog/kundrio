import Link from "next/link";
import { ProcessCard } from "@/components/process/ProcessCard";
import { EnrichmentCard } from "@/components/enrich/EnrichmentCard";
import { MentionsCard } from "@/components/research/MentionsCard";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate, formatEuro } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { canSetOwner } from "@/lib/permissions/rules";
import { contactName } from "@/lib/a-format";
import { lifecycleStages, ownerOptions } from "@/lib/objects/defaults";
import { PRIORITY_LABEL, stageLabel } from "@/lib/objects/lifecycle";
import { parseOptions } from "@/lib/properties";
import { Badge, btnCls, btnDangerCls, btnGhostCls, Card, Empty, inputCls, labelCls, PageHeader } from "@/components/ui";
import { Flash } from "@/components/b/Flash";
import { deleteCompany, linkContact, mergeCompany, saveCompanyAttributes, unlinkContact, updateCompany } from "../actions";

export const dynamic = "force-dynamic";

export default async function CompanyDetail({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ ok?: string; fehler?: string }> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const c = await db.company.findFirst({
    where: { id, workspaceId: ws.id },
    include: {
      owner: { select: { name: true } },
      // Verknüpfte Datensätze nur im Rahmen der jeweiligen Reichweite
      contacts: { where: withScope({}, access, "contacts"), orderBy: { createdAt: "desc" }, take: 200 },
      deals: { where: withScope({}, access, "deals"), include: { stage: true }, orderBy: { createdAt: "desc" } },
      tickets: { where: withScope({}, access, "tickets"), include: { stage: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!c || !can(access, "companies", "read", c.ownerId)) notFound();
  const mayEdit = can(access, "companies", "edit", c.ownerId);
  const mayDelete = can(access, "companies", "delete", c.ownerId);
  const mayLink = can(access, "contacts", "edit");
  const ownerCtx = { userId: access.userId, teamUserIds: access.teamUserIds };
  const [stages, owners, props, candidates, others] = await Promise.all([
    lifecycleStages(ws.id),
    ownerOptions(ws.id),
    db.propertyDefinition.findMany({ where: { workspaceId: ws.id, objectType: "company" }, orderBy: { label: "asc" } }),
    db.contact.findMany({ where: withScope({ workspaceId: ws.id, OR: [{ companyId: null }, { NOT: { companyId: c.id } }] }, access, "contacts", "edit"), orderBy: { createdAt: "desc" }, take: 300, select: { id: true, firstName: true, lastName: true, email: true } }),
    db.company.findMany({ where: withScope({ workspaceId: ws.id, NOT: { id: c.id } }, access, "companies", "delete"), orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, domain: true } }),
  ]);
  const attrs = (c.attributes as Record<string, unknown>) ?? {};
  const openValue = c.deals.filter((d) => d.stage.kind === "OPEN").reduce((a, d) => a + d.valueCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={c.name} description={[c.domain, c.industry].filter(Boolean).join(" · ") || undefined}>
        {c.lifecycleStage && <Badge tone="accent">{stageLabel(stages, c.lifecycleStage)}</Badge>}
        <Link href={`/sa/${slug}/unternehmen`} className={btnGhostCls}>Zurück</Link>
      </PageHeader>
      <Flash ok={sp.ok} fehler={sp.fehler} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Stammdaten">
          <form action={updateCompany.bind(null, slug, c.id)}>
            <fieldset disabled={!mayEdit} className="space-y-3">
            <label className="block"><span className={labelCls}>Name *</span><input name="name" required defaultValue={c.name} className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Domain</span><input name="domain" defaultValue={c.domain ?? ""} placeholder="firma.de" className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Branche</span><input name="industry" defaultValue={c.industry ?? ""} className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Größe</span><input name="size" defaultValue={c.size ?? ""} placeholder="z. B. 10–49" className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Telefon</span><input name="phone" defaultValue={c.phone ?? ""} className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Website</span><input name="website" defaultValue={c.website ?? ""} className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Anschrift</span><textarea name="address" rows={2} defaultValue={c.address ?? ""} className={inputCls} /></label>
            <label className="block"><span className={labelCls}>Lifecycle-Phase</span>
              <select name="lifecycleStage" defaultValue={c.lifecycleStage ?? ""} className={inputCls}><option value="">–</option>{stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            </label>
            <label className="block"><span className={labelCls}>Zuständig</span>
              <select name="ownerId" defaultValue={c.ownerId ?? ""} className={inputCls}><option value="">–</option>{owners.filter((o) => o.id === c.ownerId || canSetOwner(access.perms, "companies", ownerCtx, o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            </label>
            {mayEdit && <button className={btnCls}>Speichern</button>}
            </fieldset>
          </form>
          <p className="mt-3 text-sm text-ink-400">Angelegt {formatDate(c.createdAt, true)}{c.externalRef ? ` · Herkunft ${c.externalRef}` : ""}</p>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card title={`Kontakte (${c.contacts.length})`}>
            {c.contacts.length === 0 ? <Empty>Noch keine Kontakte verknüpft.</Empty> : (
              <ul className="divide-y divide-ink-100 text-[15px] dark:divide-white/10">
                {c.contacts.map((k) => (
                  <li key={k.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/sa/${slug}/kontakte/${k.id}`} className="hover:underline">{contactName(k)}</Link>
                    <span className="flex items-center gap-2 text-sm text-ink-400">
                      {stageLabel(stages, k.lifecycleStage)}
                      {can(access, "contacts", "edit", k.ownerId) && <form action={unlinkContact.bind(null, slug, c.id, k.id)}><button className="text-sm underline">lösen</button></form>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {mayLink && <form action={linkContact.bind(null, slug, c.id)} className="mt-3 flex gap-2">
              <label className="sr-only" htmlFor="contactId">Kontakt verknüpfen</label>
              <select id="contactId" name="contactId" required className={inputCls} defaultValue="">
                <option value="" disabled>Kontakt verknüpfen …</option>
                {candidates.map((k) => <option key={k.id} value={k.id}>{contactName(k)}</option>)}
              </select>
              <button className={btnGhostCls}>Verknüpfen</button>
            </form>}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title={`Deals · offen ${formatEuro(openValue)}`}>
              {c.deals.length === 0 ? <Empty>Keine Deals.</Empty> : (
                <ul className="divide-y divide-ink-100 text-[15px] dark:divide-white/10">
                  {c.deals.map((d) => <li key={d.id} className="flex justify-between py-1.5"><Link href={`/sa/${slug}/pipeline`} className="hover:underline">{d.title}</Link><span className="text-sm text-ink-400">{d.stage.name} · {formatEuro(d.valueCents)}</span></li>)}
                </ul>
              )}
            </Card>
            <Card title="Tickets">
              {c.tickets.length === 0 ? <Empty>Keine Tickets.</Empty> : (
                <ul className="divide-y divide-ink-100 text-[15px] dark:divide-white/10">
                  {c.tickets.map((t) => <li key={t.id} className="flex justify-between py-1.5"><Link href={`/sa/${slug}/tickets/${t.id}`} className="hover:underline">#{t.numericId} {t.subject}</Link><span className="text-sm text-ink-400">{t.stage.name} · {PRIORITY_LABEL[t.priority] ?? t.priority}</span></li>)}
                </ul>
              )}
            </Card>
          </div>

          {props.length > 0 && (
            <Card title="Eigene Felder">
              <form action={saveCompanyAttributes.bind(null, slug, c.id)}>
                <fieldset disabled={!mayEdit} className="grid gap-3 sm:grid-cols-2">
                {props.map((p) => {
                  const v = attrs[p.key];
                  const name = `attr_${p.key}`;
                  return p.type === "boolean" ? (
                    <label key={p.id} className="flex items-center gap-2"><input type="checkbox" name={name} defaultChecked={v === true} /> <span className="text-[15px]">{p.label}</span></label>
                  ) : (
                    <label key={p.id} className="block">
                      <span className={labelCls}>{p.label} <code className="text-xs text-ink-400">{p.key}</code></span>
                      {p.type === "select" ? (
                        <select name={name} defaultValue={v == null ? "" : String(v)} className={inputCls}><option value="">–</option>{parseOptions(p.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                      ) : (
                        <input name={name} type={p.type === "date" ? "date" : p.type === "number" ? "number" : "text"} step="any" defaultValue={v == null ? "" : p.type === "date" ? String(v).slice(0, 10) : String(v)} className={inputCls} />
                      )}
                    </label>
                  );
                })}
                {mayEdit && <div className="sm:col-span-2"><button className={btnCls}>Felder speichern</button></div>}
                </fieldset>
              </form>
            </Card>
          )}

          {mayDelete && mayEdit && others.length > 0 && (
          <Card title="Dublette zusammenführen">
            <form action={mergeCompany.bind(null, slug, c.id)} className="space-y-3">
              <p className="text-[15px] text-ink-600 dark:text-ink-200">Kontakte, Deals und Tickets der gewählten Dublette werden zu „{c.name}“ verschoben, fehlende Angaben ergänzt, die Dublette danach gelöscht.</p>
              <label className="block"><span className={labelCls}>Dublette</span>
                <select name="dropId" required defaultValue="" className={inputCls}><option value="" disabled>Unternehmen wählen …</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}{o.domain ? ` (${o.domain})` : ""}</option>)}</select>
              </label>
              <label className="flex items-start gap-2 text-[15px]"><input type="checkbox" name="confirm" className="mt-1" /> <span>Ja, zusammenführen. Das lässt sich nicht rückgängig machen.</span></label>
              <button className={btnGhostCls}>Zusammenführen</button>
            </form>
          </Card>
          )}

          {mayDelete && (
            <form action={deleteCompany.bind(null, slug, c.id)}>
              <button className={btnDangerCls}>Unternehmen löschen</button>
            </form>
          )}
        </div>
      </div>
      <EnrichmentCard slug={slug} workspaceId={ws.id} objectType="company" objectId={c.id} canEdit={can(access, "companies", "edit", c.ownerId)} />
      <MentionsCard slug={slug} objectType="company" objectId={c.id} />
      <ProcessCard slug={slug} workspaceId={ws.id} objectType="company" objectId={c.id} access={access} />
    </div>
  );
}
