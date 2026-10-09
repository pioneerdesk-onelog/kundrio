import Link from "next/link";
import { Download } from "lucide-react";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { getProgress } from "@/lib/migrate/brevo-import";
import { listOptions } from "@/lib/lists";
import { formatDate } from "@/lib/workspace";
import { Badge, btnDangerCls, btnGhostCls, Card, PageHeader } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";
import { AutoRefresh } from "@/components/lists/AutoRefresh";
import { BrevoImportForm } from "@/components/lists/BrevoImportForm";
import { CsvImport } from "@/components/lists/CsvImport";
import { cancelBrevoImport, csvStep, startBrevoImport } from "../actions";
import { getHubspotProgress } from "@/lib/migrate/hubspot-import";
import { HubspotImportForm } from "@/components/objects/HubspotImportForm";
import { HubspotProgress } from "@/components/objects/HubspotProgress";
import { cancelHubspotImport, startHubspotImport } from "./hubspot-actions";

export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<string, string> = {
  attributes: "Felder", lists: "Listen", contacts: "Kontakte", blocked: "Sperrliste", templates: "Vorlagen", done: "Fertig",
};
const STATUS_TONE = { running: "accent", done: "ok", failed: "bad", cancelled: "warn" } as const;
const STATUS_LABEL = { running: "läuft", done: "fertig", failed: "fehlgeschlagen", cancelled: "abgebrochen" };

export default async function WechselPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: FlashParams }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  // Import: Sonderrecht + Kontakte bearbeiten · Export: Sonderrecht + volle Lese-Reichweite
  const admin = hasSpecial(access, "import") && can(access, "contacts", "edit");
  const mayExport = hasSpecial(access, "export") && access.perms.objects.contacts.read === "all";
  const [progress, lists, hsProgress] = await Promise.all([getProgress(ws.id), listOptions(ws.id), getHubspotProgress(ws.id)]);
  const hsRunning = hsProgress?.status === "running";
  const running = progress?.status === "running";

  return (
    <div className="space-y-6">
      <PageHeader title="Wechsel in beide Richtungen" description="Kein Lock-in: Daten kommen aus Brevo oder HubSpot herein – und gehen jederzeit im selben Format wieder hinaus.">
        <Link href={`/sa/${slug}/listen`} className={btnGhostCls}>Zurück</Link>
      </PageHeader>
      <Flash {...await searchParams} />
      <AutoRefresh active={running || hsRunning} />
      {!admin && <p className="text-[15px] text-amber-800 dark:text-amber-300">Für Importe fehlt Ihnen das Recht „Daten importieren“.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Import aus Brevo (über die API)">
          <p className="mb-3 text-[15px] text-ink-600 dark:text-ink-200">
            Übernimmt Kontakte mit Attributen, Listen und Mitgliedschaften, eigene Felder, Abmeldungen und die Sperrliste sowie
            Transaktions-Vorlagen. Bestehende Kontakte werden nur ergänzt. Mehrfach ausführen schadet nicht.
          </p>
          <BrevoImportForm action={startBrevoImport.bind(null, slug)} disabled={!admin || running} />
        </Card>

        <Card title="Export – der Weg zurück">
          <p className="mb-3 text-[15px] text-ink-600 dark:text-ink-200">Fertige Import-Dateien für Brevo und HubSpot, inklusive eigener Felder, Listen und Abmeldestatus.</p>
          {mayExport ? (
            <div className="flex flex-wrap gap-2">
              <a href={`/sa/${slug}/listen/wechsel/export/brevo`} className={btnGhostCls}><Download size={16} aria-hidden /> Brevo-CSV</a>
              <a href={`/sa/${slug}/listen/wechsel/export/hubspot`} className={btnGhostCls}><Download size={16} aria-hidden /> HubSpot-CSV</a>
              <a href={`/sa/${slug}/listen/wechsel/export/sperrliste`} className={btnGhostCls}><Download size={16} aria-hidden /> Sperrliste</a>
              <a href={`/sa/${slug}/listen/wechsel/export/hubspot-companies`} className={btnGhostCls}><Download size={16} aria-hidden /> HubSpot: Unternehmen</a>
              <a href={`/sa/${slug}/listen/wechsel/export/hubspot-deals`} className={btnGhostCls}><Download size={16} aria-hidden /> HubSpot: Deals</a>
              <a href={`/sa/${slug}/listen/wechsel/export/hubspot-tickets`} className={btnGhostCls}><Download size={16} aria-hidden /> HubSpot: Tickets</a>
            </div>
          ) : <p className="text-sm text-ink-400">Dafür fehlt das Recht „Daten exportieren“.</p>}
          <p className="mt-3 text-sm text-ink-400">Vollständiger Datenexport (alle Tabellen, JSON) unter Einstellungen → Export.</p>
        </Card>
      </div>

      <Card title="Import aus HubSpot (über die API)">
        <p className="mb-3 text-[15px] text-ink-600 dark:text-ink-200">
          Übernimmt Unternehmen, Kontakte (inkl. Lifecycle-Phase, Abmeldungen), Deals mit Pipelines, Tickets, Verknüpfungen, eigene Felder,
          Zuständige (per E-Mail zu Benutzern zugeordnet) und Notizen. Bestehende Datensätze werden nur ergänzt; mehrfach ausführen schadet nicht.
          Einwilligungen werden nur übernommen, wenn HubSpot „Einwilligung“ als Rechtsgrundlage belegt.
        </p>
        <HubspotImportForm action={startHubspotImport.bind(null, slug)} disabled={!admin || hsRunning} />
      </Card>
      {hsProgress && <HubspotProgress progress={hsProgress} cancel={cancelHubspotImport.bind(null, slug)} admin={admin} />}

      {progress && (
        <Card title={<span className="flex items-center gap-2">Letzter Brevo-Import <Badge tone={STATUS_TONE[progress.status]}>{STATUS_LABEL[progress.status]}</Badge></span>}>
          <p className="text-[15px]">
            Gestartet {formatDate(new Date(progress.startedAt), true)}{progress.startedBy ? ` von ${progress.startedBy}` : ""} · Schritt: <strong>{PHASE_LABEL[progress.phase]}</strong>
            {progress.finishedAt && ` · beendet ${formatDate(new Date(progress.finishedAt), true)}`}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-[15px] sm:grid-cols-4">
            <div><dt className="text-sm text-ink-400">Kontakte</dt><dd className="font-semibold tabular-nums">{progress.counts.contacts}{progress.totalContacts ? ` / ${progress.totalContacts}` : ""}</dd></div>
            <div><dt className="text-sm text-ink-400">neu / ergänzt</dt><dd className="font-semibold tabular-nums">{progress.counts.created} / {progress.counts.updated}</dd></div>
            <div><dt className="text-sm text-ink-400">Listen · Felder</dt><dd className="font-semibold tabular-nums">{progress.counts.lists} · {progress.counts.attributes}</dd></div>
            <div><dt className="text-sm text-ink-400">Gesperrt · Vorlagen</dt><dd className="font-semibold tabular-nums">{progress.counts.suppressed} · {progress.counts.templates}</dd></div>
          </dl>
          {progress.errors.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm text-red-700 dark:text-red-300">{progress.errors.slice(-5).map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
          {running && admin && (
            <form action={cancelBrevoImport.bind(null, slug)} className="mt-3"><button className={btnDangerCls}>Import abbrechen</button></form>
          )}

          {(Object.keys(progress.listMap).length > 0 || progress.templateMap.length > 0) && (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {Object.keys(progress.listMap).length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Listen-IDs (Brevo → hier)</h3>
                  <table className="w-full text-sm"><tbody className="divide-y divide-ink-100 dark:divide-white/10">
                    {Object.entries(progress.listMap).map(([b, l]) => <tr key={b}><td className="py-1 font-mono">#{b}</td><td>→</td><td className="font-mono">#{l.numericId}</td><td>{l.name}</td></tr>)}
                  </tbody></table>
                </div>
              )}
              {progress.templateMap.length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Vorlagen-IDs (Brevo-templateId → hier)</h3>
                  <table className="w-full text-sm"><tbody className="divide-y divide-ink-100 dark:divide-white/10">
                    {progress.templateMap.map((t) => <tr key={t.brevoId}><td className="py-1 font-mono">#{t.brevoId}</td><td>→</td><td className="font-mono">#{t.numericId}</td><td>{t.name}</td></tr>)}
                  </tbody></table>
                  <p className="mt-1 text-sm text-ink-400">Produkte, die per templateId senden, müssen auf die neuen IDs umgestellt werden.</p>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <Card title="Import per CSV (Brevo-Export, HubSpot-Export oder eigene Datei)">
        {admin ? <CsvImport action={csvStep.bind(null, slug)} lists={lists.map((l) => ({ id: l.id, name: l.name }))} /> : <p className="text-sm text-ink-400">Dafür fehlt das Recht „Daten importieren“.</p>}
      </Card>

      <Card title="Was sich nicht übertragen lässt">
        <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink-600 dark:text-ink-200">
          <li>Kampagnen-Statistiken (Öffnungen, Klicks) und Versandhistorie – bleiben im Altsystem; vorher als Bericht sichern.</li>
          <li>Workflows/Automationen – Brevo und HubSpot exportieren nur Übersichten; unter „Automationen“ neu anlegen.</li>
          <li>Formulare und Landingpages – neu bauen (Formulare, Landingpages).</li>
          <li>Einwilligungsnachweise im Detail (Zeitpunkt, IP der Bestätigung) – nur der Status wird übernommen; Nachweise im Altsystem archivieren.</li>
        </ul>
      </Card>
    </div>
  );
}
