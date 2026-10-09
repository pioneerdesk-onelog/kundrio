import Link from "next/link";
import { db } from "@/lib/db";
import { lifecycleStages, ownerOptions } from "@/lib/objects/defaults";
import { btnGhostCls, Card, inputCls, labelCls } from "@/components/ui";
import { matchCompanyByDomain, setContactCompany, setContactOwner, setLifecycle } from "@/app/(admin)/sa/[slug]/kontakte/actions";
import { LifecycleForm } from "./LifecycleForm";

// Vertriebs-Angaben auf der Kontaktdetailseite: Lifecycle-Phase, Zuständige Person, Unternehmen.
export async function SalesCard({
  slug,
  workspaceId,
  contact,
  canEdit = true,
  assignableOwnerIds,
}: {
  slug: string;
  workspaceId: string;
  contact: { id: string; lifecycleStage: string; ownerId: string | null; companyId: string | null };
  /** false = nur ansehen (fehlendes Bearbeiten-Recht) */
  canEdit?: boolean;
  /** Personen, die zugewiesen werden dürfen (undefined = alle) */
  assignableOwnerIds?: string[];
}) {
  const [stages, owners, companies] = await Promise.all([
    lifecycleStages(workspaceId),
    ownerOptions(workspaceId),
    db.company.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, domain: true } }),
  ]);
  const company = companies.find((c) => c.id === contact.companyId);
  // Nur Personen innerhalb der eigenen Reichweite anbieten; die aktuelle Zuständige bleibt sichtbar
  const ownerChoices = assignableOwnerIds ? owners.filter((o) => assignableOwnerIds.includes(o.id) || o.id === contact.ownerId) : owners;
  return (
    <Card title="Vertrieb">
      <fieldset disabled={!canEdit} className="grid gap-4 disabled:opacity-80 sm:grid-cols-3">
        <LifecycleForm stages={stages.map((s) => ({ key: s.key, label: s.label, position: s.position }))} current={contact.lifecycleStage} action={setLifecycle.bind(null, slug, contact.id)} />
        <form action={setContactOwner.bind(null, slug, contact.id)} className="space-y-2">
          <label className="block">
            <span className={labelCls}>Zuständig</span>
            <select name="ownerId" defaultValue={contact.ownerId ?? ""} className={inputCls}>
              <option value="">– niemand –</option>
              {ownerChoices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          {canEdit && <button className={btnGhostCls}>Zuweisen</button>}
        </form>
        <div className="space-y-2">
          <form action={setContactCompany.bind(null, slug, contact.id)} className="space-y-2">
            <label className="block">
              <span className={labelCls}>Unternehmen{company && <> · <Link href={`/sa/${slug}/unternehmen/${company.id}`} className="underline">öffnen</Link></>}</span>
              <select name="companyId" defaultValue={contact.companyId ?? ""} className={inputCls}>
                <option value="">– keines –</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.domain ? ` (${c.domain})` : ""}</option>)}
              </select>
            </label>
            {canEdit && <button className={btnGhostCls}>Verknüpfen</button>}
          </form>
          {canEdit && !contact.companyId && (
            <form action={matchCompanyByDomain.bind(null, slug, contact.id)}>
              <button className="text-sm underline">Per E-Mail-Domain zuordnen</button>
            </form>
          )}
        </div>
      </fieldset>
    </Card>
  );
}
