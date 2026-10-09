import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { pageAccess } from "@/lib/permissions/guard";
import { getRun } from "@/lib/process/api";
import { OBJECT_LABELS, type ObjectType, type ProcessDefinition } from "@/lib/process/definition";
import { Badge, Card, PageHeader } from "@/components/ui";
import { RUN_STATUS, RunTimeline } from "@/components/process/RunTimeline";
import { objectHref } from "../../../links";

export const dynamic = "force-dynamic";

export default async function LaufPage({ params }: { params: Promise<{ slug: string; id: string; runId: string }> }) {
  const { slug, id, runId } = await params;
  const { ws } = await pageAccess(slug);
  const meta = await db.processRun.findFirst({
    where: { id: runId, processId: id, workspaceId: ws.id },
    include: { process: { select: { name: true } }, version: { select: { version: true, definition: true } } },
  });
  if (!meta) notFound();

  let run: Awaited<ReturnType<typeof getRun>> | null = null;
  let error: string | null = null;
  try {
    run = await getRun(ws.id, runId);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Beschriftungen der Knoten aus der Version, auf der der Lauf läuft
  const def = meta.version.definition as unknown as ProcessDefinition;
  const labels = Object.fromEntries((def?.nodes ?? []).filter((n) => n.label).map((n) => [n.id, n.label as string]));
  const st = RUN_STATUS[meta.status] ?? { label: meta.status, tone: "neutral" as const };
  const href = objectHref(slug, meta.objectType, meta.objectId);

  return (
    <div className="space-y-5">
      <nav aria-label="Brotkrumen" className="flex gap-3 text-sm">
        <Link href={`/sa/${slug}/prozesse/${id}/laeufe`} className="text-accent-500 hover:underline dark:text-accent-100">
          ← Alle Läufe
        </Link>
        <Link href={`/sa/${slug}/prozesse/${id}`} className="text-accent-500 hover:underline dark:text-accent-100">
          Editor
        </Link>
      </nav>
      <PageHeader title={`Lauf von „${meta.process.name}“`} />
      <Card>
        <dl className="grid gap-3 text-[15px] sm:grid-cols-4">
          <div>
            <dt className="text-sm text-ink-400 dark:text-ink-200">Status</dt>
            <dd>
              <Badge tone={st.tone}>{st.label}</Badge> {meta.test && <Badge tone="accent">Testlauf</Badge>}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-400 dark:text-ink-200">Datensatz</dt>
            <dd>
              {href ? (
                <Link href={href} className="text-accent-500 hover:underline dark:text-accent-100">
                  {OBJECT_LABELS[meta.objectType as ObjectType] ?? meta.objectType} öffnen
                </Link>
              ) : (
                meta.objectId
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-400 dark:text-ink-200">Version</dt>
            <dd>v{meta.version.version}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-400 dark:text-ink-200">Gestartet / beendet</dt>
            <dd>
              {formatDate(meta.startedAt, true)} / {formatDate(meta.finishedAt, true)}
            </dd>
          </div>
        </dl>
        {meta.error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[15px] text-red-800 dark:bg-red-500/10 dark:text-red-200">{meta.error}</p>}
      </Card>
      <Card title="Schritt-Protokoll">
        {error ? <p role="alert" className="text-[15px] text-red-700 dark:text-red-300">{error}</p> : <RunTimeline steps={run?.steps ?? []} labels={labels} />}
      </Card>
    </div>
  );
}
