import { Card } from "@/components/ui";
import { StateForm, Submit } from "@/components/users/StateForm";
import { RowAction } from "@/components/users/RowAction";
import { createArt14Template, saveEnrichSettings } from "@/app/(admin)/sa/[slug]/anreicherung/actions";
import { ART14_TEMPLATE_NAME } from "@/lib/enrich/art14";
import { db } from "@/lib/db";

// Einstellung „Personen anreichern“ (nur beruflich) mit Rechtshinweis und Art.-14-Vorlage.

export async function EnrichSettings({ slug, workspaceId, canManage }: { slug: string; workspaceId: string; canManage: boolean }) {
  const [ws, template] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { enrichPersons: true } }),
    db.emailTemplate.findFirst({ where: { workspaceId, name: ART14_TEMPLATE_NAME }, select: { numericId: true } }),
  ]);
  return (
    <Card title="Einstellungen & Datenschutz">
      <div className="space-y-3 text-[15px]">
        <p>
          <strong>Unternehmen</strong> werden aus ihrer eigenen Website (inkl. Pflichtangaben im Impressum) angereichert. Das betrifft in der Regel keine
          Privatpersonen.
        </p>
        <p>
          <strong>Personen</strong> werden nur beruflich angereichert (Funktion, Links zu öffentlichen beruflichen Profilen) und nur, wenn Sie das hier
          einschalten. Rechtsgrundlage ist in der Regel das berechtigte Interesse (Art. 6 Abs. 1 lit. f DSGVO). Weil die Daten nicht bei der Person selbst
          erhoben werden, müssen Sie sie innerhalb eines Monats informieren (Art. 14 DSGVO). Ein Widerspruch wird über den Tag „keine-anreicherung“ am Kontakt
          berücksichtigt. Bitte im Zweifel rechtlich prüfen lassen.
        </p>
        <StateForm action={saveEnrichSettings.bind(null, slug)}>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="enrichPersons" defaultChecked={ws.enrichPersons} disabled={!canManage} />
            Personen (nur beruflich) anreichern
          </label>
          {canManage && <Submit variant="ghost">Speichern</Submit>}
        </StateForm>
        <div className="border-t border-ink-100 pt-3 dark:border-white/10">
          <p className="mb-2">
            Vorlage für die Informationspflicht:{" "}
            {template ? <span>angelegt (Vorlagen-ID {template.numericId}, unter E-Mail → Vorlagen anpassbar)</span> : <span>noch nicht angelegt</span>}
          </p>
          {canManage && !template && <RowAction action={createArt14Template.bind(null, slug)} label="Vorlage anlegen" />}
        </div>
      </div>
    </Card>
  );
}
