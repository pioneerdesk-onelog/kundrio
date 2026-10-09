import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/c/SubmitButton";
import { AddTextForm, AddUrlForm, AskForm, ReindexButton } from "./forms";
import { deleteSource, setSourcePublic } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  indexed: "text-green-700 dark:text-green-500",
  pending: "text-amber-600",
  failed: "text-red-600",
};

export default async function WissenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const mayEdit = can(access, "knowledge", "edit");
  const mayDelete = can(access, "knowledge", "delete");
  const sources = await db.knowledgeSource.findMany({
    where: { workspaceId: ws.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { chunks: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Wissen (RAG)" />
      <Card title="Frage stellen">
        <AskForm slug={slug} />
        <p className="mt-2 text-xs text-ink-400 dark:text-ink-200">
          Suche und Antwort laufen lokal über Ollama, nur im Wissen von {ws.name}. Hier werden alle Quellen genutzt; die öffentliche
          Agent-Schnittstelle zitiert nur Quellen mit „Öffentlich für KI-Agenten“.
        </p>
      </Card>

      {mayEdit && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Text hinzufügen"><AddTextForm slug={slug} /></Card>
          <Card title="Webseite hinzufügen"><AddUrlForm slug={slug} /></Card>
        </div>
      )}

      <Card title={`Quellen (${sources.length})`}>
        {sources.length === 0 ? (
          <Empty>Noch keine Quellen. Füge Text, eine Webseite oder eine Wiki-Seite hinzu.</Empty>
        ) : (
          <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.title}</span>
                    {s.isPublic ? <Badge tone="accent">Öffentlich für KI-Agenten</Badge> : <Badge>Intern</Badge>}
                  </div>
                  <div className="text-xs text-ink-400 dark:text-ink-200">
                    {s.kind}
                    {s.uri && ` · ${s.uri}`} · {s._count.chunks} Abschnitte · {formatDate(s.updatedAt, true)} ·{" "}
                    <span className={STATUS[s.status] ?? ""}>{s.status}</span>
                  </div>
                  {s.error && <div className="mt-1 text-xs text-red-600">Fehler: {s.error}</div>}
                </div>
                {mayEdit && (
                  <>
                    <form action={setSourcePublic.bind(null, slug, s.id, !s.isPublic)}>
                      <SubmitButton ghost pending="…">{s.isPublic ? "Nur intern" : "Für KI-Agenten freigeben"}</SubmitButton>
                    </form>
                    <ReindexButton slug={slug} id={s.id} />
                  </>
                )}
                {mayDelete && (
                  <form action={deleteSource.bind(null, slug, s.id)}>
                    <SubmitButton ghost pending="…" confirm={`Quelle „${s.title}“ löschen?`}>Löschen</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
