import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { renderTemplate } from "@/lib/mail-template";
import { Badge, Card, PageHeader, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { Flash } from "@/components/b/Flash";
import { SubmitButton } from "@/components/c/SubmitButton";
import { TemplateForm } from "@/components/mail/TemplateForm";
import { deleteTemplate, saveTemplate, sendTestTemplate, toggleTemplate } from "../actions";

export const dynamic = "force-dynamic";

function sampleParams(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.length > 5000) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ ok?: string; fehler?: string; beispiel?: string }>;
}) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const mayEdit = can(access, "email", "edit");
  const t = await db.emailTemplate.findFirst({ where: { id, workspaceId: ws.id } });
  if (!t) notFound();

  const sample = sp.beispiel ?? '{"name": "Erika"}';
  const previewHtml = renderTemplate(t.html, { params: sampleParams(sample), contact: { FIRSTNAME: "Erika", LASTNAME: "Muster", EMAIL: "erika@example.com" } }, { html: true });

  return (
    <div className="space-y-6">
      <PageHeader title={`Vorlage #${t.numericId}: ${t.name}`} description={`templateId ${t.numericId} – so in API-Aufrufen verwenden.`}>
        <Link href={`/sa/${slug}/email/vorlagen`} className={btnGhostCls}>Alle Vorlagen</Link>
      </PageHeader>
      <Flash ok={sp.ok} fehler={sp.fehler} />

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={t.isActive ? "ok" : "neutral"}>{t.isActive ? "aktiv" : "inaktiv"}</Badge>
        {mayEdit && <form action={toggleTemplate.bind(null, slug, t.id)}><button className={btnGhostCls}>{t.isActive ? "Deaktivieren" : "Aktivieren"}</button></form>}
        {can(access, "email", "delete") && (
          <form action={deleteTemplate.bind(null, slug, t.id)}>
            <SubmitButton ghost confirm={`Vorlage #${t.numericId} wirklich löschen? Produkte, die sie nutzen, erhalten dann einen Fehler.`}>Löschen</SubmitButton>
          </form>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {mayEdit ? (
          <Card title="Bearbeiten">
            <TemplateForm action={saveTemplate.bind(null, slug, t.id)} t={t} />
          </Card>
        ) : (
          <Card title="Inhalt">
            <p className="text-[15px]"><strong>Betreff:</strong> {t.subject}</p>
          </Card>
        )}
        <div className="space-y-6">
          <Card title="Vorschau">
            <form className="mb-3 flex flex-wrap items-end gap-2" method="get">
              <label className="min-w-0 flex-1">
                <span className={labelCls}>Beispielwerte für params (JSON)</span>
                <input name="beispiel" defaultValue={sample} maxLength={5000} className={`${inputCls} font-mono text-sm`} />
              </label>
              <button className={btnGhostCls}>Aktualisieren</button>
            </form>
            {/* sandbox ohne Rechte: keine Skripte, keine Formulare, kein Zugriff auf diese Seite */}
            <iframe title="Vorschau der Vorlage" sandbox="" srcDoc={previewHtml} className="h-[520px] w-full rounded-md border border-ink-100 bg-white dark:border-white/10" />
          </Card>
          {mayEdit && (
          <Card title="Testversand">
            <form action={sendTestTemplate.bind(null, slug, t.id)} className="space-y-3">
              <input type="hidden" name="params" value={sample} />
              <p className="text-sm text-ink-600 dark:text-ink-200">Geht an Ihre eigene Adresse, mit den Beispielwerten aus der Vorschau.</p>
              <SubmitButton pending="Sende …">Testmail senden</SubmitButton>
            </form>
          </Card>
          )}
        </div>
      </div>
    </div>
  );
}
