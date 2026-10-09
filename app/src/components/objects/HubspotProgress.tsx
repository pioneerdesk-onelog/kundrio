import { formatDate } from "@/lib/workspace";
import { Badge, btnDangerCls, Card } from "@/components/ui";
import type { HsProgress } from "@/lib/migrate/hubspot-import";

const PHASE_LABEL: Record<string, string> = {
  owners: "Zuständige", properties: "Eigenschaften", pipelines: "Pipelines", companies: "Unternehmen", contacts: "Kontakte",
  deals: "Deals", tickets: "Tickets", notes: "Notizen", done: "Fertig",
};
const STATUS_TONE = { running: "accent", done: "ok", failed: "bad", cancelled: "warn" } as const;
const STATUS_LABEL = { running: "läuft", done: "fertig", failed: "fehlgeschlagen", cancelled: "abgebrochen" };

export function HubspotProgress({ progress, cancel, admin }: { progress: HsProgress; cancel: () => Promise<void>; admin: boolean }) {
  const c = progress.counts;
  const unmatched = Object.values(progress.ownerMap).filter((v) => !v).length;
  return (
    <Card title={<span className="flex items-center gap-2">Letzter HubSpot-Import <Badge tone={STATUS_TONE[progress.status]}>{STATUS_LABEL[progress.status]}</Badge></span>}>
      <p className="text-[15px]">
        Gestartet {formatDate(new Date(progress.startedAt), true)}{progress.startedBy ? ` von ${progress.startedBy}` : ""} · Schritt: <strong>{PHASE_LABEL[progress.phase]}</strong>
        {progress.finishedAt && ` · beendet ${formatDate(new Date(progress.finishedAt), true)}`}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[15px] sm:grid-cols-4">
        <div><dt className="text-sm text-ink-400">Unternehmen · Kontakte</dt><dd className="font-semibold tabular-nums">{c.companies} · {c.contacts}</dd></div>
        <div><dt className="text-sm text-ink-400">Deals · Tickets</dt><dd className="font-semibold tabular-nums">{c.deals} · {c.tickets}</dd></div>
        <div><dt className="text-sm text-ink-400">neu / ergänzt / übersprungen</dt><dd className="font-semibold tabular-nums">{c.created} / {c.updated} / {c.skipped}</dd></div>
        <div><dt className="text-sm text-ink-400">Notizen · gesperrt</dt><dd className="font-semibold tabular-nums">{c.notes} · {c.suppressed}</dd></div>
      </dl>
      <p className="mt-2 text-sm text-ink-400">
        {c.owners} Zuständige ({unmatched} ohne passenden Benutzer, bleiben leer) · {c.properties} eigene Felder · {c.pipelines} Pipelines („… (HubSpot)“)
      </p>
      {progress.errors.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-red-700 dark:text-red-300">{progress.errors.slice(-5).map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}
      {progress.status === "running" && admin && (
        <form action={cancel} className="mt-3"><button className={btnDangerCls}>Import abbrechen</button></form>
      )}
    </Card>
  );
}
