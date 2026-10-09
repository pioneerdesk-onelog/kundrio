import Link from "next/link";
import { plural } from "@/lib/a-format";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { listProcesses, listTemplates, type ProcessSummary } from "@/lib/process/api";
import { definitionSchema, OBJECT_LABELS, type ObjectType, type ProcessDefinition } from "@/lib/process/definition";
import { checkReferences } from "@/lib/process/fields";
import { loadCatalogData } from "@/lib/process/fields-server";
import { MiniFlow } from "@/components/process/MiniFlow";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { NewEmptyProcess, TemplateGallery } from "@/components/process/NewProcess";
import { createEmptyProcess, createFromTemplate } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "ok" | "neutral" | "warn" | "bad" | "accent" }> = {
  DRAFT: { label: "Entwurf", tone: "neutral" },
  ACTIVE: { label: "Aktiv", tone: "ok" },
  PAUSED: { label: "Pausiert", tone: "warn" },
  ARCHIVED: { label: "Archiv", tone: "neutral" },
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default async function ProzessePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ archiv?: string }> }) {
  const { slug } = await params;
  const { archiv } = await searchParams;
  const { ws, access } = await pageAccess(slug);

  let processes: ProcessSummary[] = [];
  let loadError: string | undefined;
  try {
    processes = await listProcesses(ws.id);
  } catch (e) {
    loadError = msg(e);
  }
  let templates: Awaited<ReturnType<typeof listTemplates>> = [];
  let templateError: string | undefined;
  try {
    templates = await listTemplates();
  } catch (e) {
    templateError = msg(e);
  }

  const since = new Date(Date.now() - 7 * 864e5);
  const ids = processes.map((p) => p.id);
  const [runs, failed, lastRuns, externals] = ids.length
    ? await Promise.all([
        db.processRun.groupBy({ by: ["processId"], where: { workspaceId: ws.id, processId: { in: ids }, startedAt: { gte: since }, test: false }, _count: true }),
        db.processRun.groupBy({ by: ["processId"], where: { workspaceId: ws.id, processId: { in: ids }, startedAt: { gte: since }, status: "failed", test: false }, _count: true }),
        db.processRun.groupBy({ by: ["processId"], where: { workspaceId: ws.id, processId: { in: ids }, test: false }, _max: { startedAt: true } }),
        // Außenwirkung: letzte Version je Prozess (Entwurf oder aktiv)
        db.processVersion.findMany({ where: { processId: { in: ids } }, orderBy: { version: "desc" }, distinct: ["processId"], select: { processId: true, external: true, approvedAt: true } }),
      ])
    : [[], [], [], []];
  const count = (rows: { processId: string; _count: number }[], id: string) => rows.find((r) => r.processId === id)?._count ?? 0;

  // Landkarte: aktuelle Definition je Prozess (aktive Version, sonst Entwurf) + Prüfung auf gelöschte Bezüge
  const [versions, catalog, activeIds] = await Promise.all([
    ids.length ? db.processVersion.findMany({ where: { processId: { in: ids } }, orderBy: { version: "desc" }, select: { id: true, processId: true, definition: true } }) : Promise.resolve([]),
    loadCatalogData(ws.id),
    ids.length ? db.process.findMany({ where: { id: { in: ids }, workspaceId: ws.id }, select: { id: true, activeVersionId: true } }) : Promise.resolve([]),
  ]);
  const defs = new Map<string, ProcessDefinition>();
  const brokenRefs = new Map<string, string[]>();
  for (const p of processes) {
    const all = versions.filter((v) => v.processId === p.id);
    const activeId = activeIds.find((x) => x.id === p.id)?.activeVersionId;
    const raw = all.find((v) => v.id === activeId)?.definition ?? all[0]?.definition;
    const parsed = definitionSchema.safeParse(raw);
    if (!parsed.success) continue;
    defs.set(p.id, parsed.data);
    const errs = checkReferences(catalog, p.objectType as ObjectType, parsed.data).filter((i) => i.level === "error");
    if (errs.length) brokenRefs.set(p.id, errs.map((e) => e.message));
  }

  const visible = processes.filter((p) => (archiv ? p.status === "ARCHIVED" : p.status !== "ARCHIVED"));
  const archivedCount = processes.filter((p) => p.status === "ARCHIVED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prozesse"
        description="Abläufe, die im Hintergrund zuverlässig arbeiten: Daten pflegen, Leads erkennen und bewerten, Aufgaben verteilen, nachfassen. Jeder Schritt wird protokolliert; Aktionen mit Außenwirkung starten erst nach Freigabe."
      />

      <Card title={archiv ? "Archivierte Prozesse" : "Ihre Prozesse"}>
        {loadError ? (
          <p role="alert" className="text-[15px] text-red-700 dark:text-red-300">Prozesse konnten nicht geladen werden: {loadError}</p>
        ) : visible.length === 0 ? (
          <Empty>{archiv ? "Keine archivierten Prozesse." : "Noch keine Prozesse. Starten Sie mit einer Best-Practice-Vorlage weiter unten."}</Empty>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2" aria-label="Prozess-Landkarte">
            {visible.map((p) => {
              const ext = externals.find((x) => x.processId === p.id);
              const st = STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
              const f = count(failed, p.id);
              const def = defs.get(p.id);
              const broken = brokenRefs.get(p.id);
              return (
                <li key={p.id} className="rounded-xl border border-ink-100 bg-white p-4 dark:border-white/10 dark:bg-ink-900">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link href={`/sa/${slug}/prozesse/${p.id}`} className="font-display text-lg text-ink-900 hover:underline dark:text-ink-50">
                        {p.name}
                      </Link>
                      <div className="text-sm text-ink-400 dark:text-ink-200">{OBJECT_LABELS[p.objectType]}</div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {p.templateKey && <Badge tone="accent">Best Practice</Badge>}
                      {ext?.external && <Badge tone="warn">{ext.approvedAt ? "Außenwirkung – freigegeben" : "Außenwirkung – Freigabe nötig"}</Badge>}
                    </div>
                  </div>
                  {def && (
                    <div className="mt-3">
                      <MiniFlow def={def} />
                    </div>
                  )}
                  {broken && (
                    <div role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">
                      <strong>Prozess verweist auf Gelöschtes oder Fehlendes:</strong> {broken.slice(0, 2).join(" · ")}
                      {broken.length > 2 ? ` (+${broken.length - 2} weitere)` : ""}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-600 dark:text-ink-200">
                    <span className="tabular-nums">
                      {p.activeVersion ? `v${p.activeVersion} aktiv` : "nicht veröffentlicht"}
                      {p.draftVersion && p.draftVersion !== p.activeVersion ? ` · Entwurf v${p.draftVersion}` : ""}
                    </span>
                    <Link href={`/sa/${slug}/prozesse/${p.id}/laeufe`} className="tabular-nums hover:underline">
                      {plural(count(runs, p.id), "Lauf", "Läufe")} (7 Tage)
                    </Link>
                    {f > 0 && (
                      <Link href={`/sa/${slug}/prozesse/${p.id}/laeufe?status=failed`}>
                        <Badge tone="bad">{f} Fehler</Badge>
                      </Link>
                    )}
                    <span>Letzter Lauf: {formatDate(lastRuns.find((r) => r.processId === p.id)?._max.startedAt ?? null, true)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 text-sm">
          {archiv ? (
            <Link href={`/sa/${slug}/prozesse`} className="text-accent-500 hover:underline dark:text-accent-100">← Zurück zu den aktiven Prozessen</Link>
          ) : archivedCount > 0 ? (
            <Link href={`/sa/${slug}/prozesse?archiv=1`} className="text-accent-500 hover:underline dark:text-accent-100">Archiv anzeigen ({archivedCount})</Link>
          ) : null}
        </div>
      </Card>

      {can(access, "processes", "edit") && <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card title="Best-Practice-Vorlagen">
          <p className="mb-4 text-[15px] text-ink-600 dark:text-ink-200">Bewährte Abläufe als Startpunkt. Sie werden als Entwurf übernommen und lassen sich vor dem Veröffentlichen anpassen.</p>
          <TemplateGallery templates={templates} action={createFromTemplate.bind(null, slug)} error={templateError} />
        </Card>
        <Card title="Eigenen Prozess anlegen">
          <NewEmptyProcess action={createEmptyProcess.bind(null, slug)} />
        </Card>
      </div>}
    </div>
  );
}
