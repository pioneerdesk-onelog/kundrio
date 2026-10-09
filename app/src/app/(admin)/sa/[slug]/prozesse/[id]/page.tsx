import Link from "next/link";
import { notFound } from "next/navigation";
import { can as canDo, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { getProcess } from "@/lib/process/api";
import { emptyDefinition, TRIGGER_TYPES, type TriggerType } from "@/lib/process/definition";
import { Card } from "@/components/ui";
import { FlowEditor } from "@/components/process/FlowEditor";
import { loadEditorOptions } from "../options";
import { processRights } from "@/lib/process/rights";
import { getRunAction, publishAction, saveDraftAction, searchObjectsAction, statusAction, testRunAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ProzessEditorPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { ws, access } = await pageAccess(slug);

  let data: Awaited<ReturnType<typeof getProcess>>;
  try {
    data = await getProcess(ws.id, id);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/nicht gefunden|not found/i.test(m)) notFound();
    return (
      <Card title="Prozess kann nicht geladen werden">
        <p role="alert" className="text-[15px] text-red-700 dark:text-red-300">{m}</p>
        <Link href={`/sa/${slug}/prozesse`} className="mt-3 inline-block text-accent-500 dark:text-accent-100 hover:underline">
          ← Zur Übersicht
        </Link>
      </Card>
    );
  }

  const [options, rights] = await Promise.all([loadEditorOptions(ws.id), processRights(ws.id, access)]);
  const { summary } = data;
  const fallbackTrigger = (Object.entries(TRIGGER_TYPES).find(([, t]) => t.objectType === summary.objectType)?.[0] ?? "manual") as TriggerType;
  const draft = data.draft ?? data.active ?? emptyDefinition(fallbackTrigger);

  return (
    <div className="space-y-3">
      <nav aria-label="Brotkrumen" className="flex gap-3 text-sm">
        <Link href={`/sa/${slug}/prozesse`} className="text-accent-500 hover:underline dark:text-accent-100">
          ← Alle Prozesse
        </Link>
        <Link href={`/sa/${slug}/prozesse/${id}/laeufe`} className="text-accent-500 hover:underline dark:text-accent-100">
          Läufe ansehen
        </Link>
      </nav>
      <FlowEditor
        processId={id}
        name={summary.name}
        status={summary.status}
        objectType={summary.objectType}
        draft={draft}
        active={data.active}
        activeVersion={summary.activeVersion}
        options={options}
        rights={rights}
        can={{ edit: canDo(access, "processes", "edit"), publish: hasSpecial(access, "publish_processes"), archive: canDo(access, "processes", "delete") }}
        actions={{
          save: saveDraftAction.bind(null, slug, id),
          publish: publishAction.bind(null, slug, id),
          setStatus: statusAction.bind(null, slug, id),
          search: searchObjectsAction.bind(null, slug),
          testRun: testRunAction.bind(null, slug, id),
          getRun: getRunAction.bind(null, slug),
        }}
      />
    </div>
  );
}
