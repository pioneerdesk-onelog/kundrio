import { wikiAuthorLabel } from "@/lib/wiki-author";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { lineDiff } from "@/lib/c-diff";
import { btnGhostCls, Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/c/SubmitButton";
import { EditForm, IndexWikiButton, ProposeForm } from "../forms";
import { applyProposal, rejectProposal } from "../actions";

export const dynamic = "force-dynamic";

const DIFF_CLS = {
  same: "text-ink-400 dark:text-ink-200",
  add: "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200",
  del: "bg-red-100 text-red-900 line-through dark:bg-red-900/30 dark:text-red-200",
} as const;

export default async function WikiPageView({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; page: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { slug, page: pageSlug } = await params;
  const { edit } = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const mayEdit = can(access, "knowledge", "edit");
  const page = await db.wikiPage.findUnique({
    where: { workspaceId_slug: { workspaceId: ws.id, slug: pageSlug } },
    include: { revisions: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!page) notFound();
  const proposals = page.revisions.filter((r) => r.status === "proposed");
  const history = page.revisions.filter((r) => r.status !== "proposed");
  const base = `/sa/${slug}/wiki/${page.slug}`;

  return (
    <div className="space-y-6">
      <PageHeader title={page.title}>
        <Link href={`/sa/${slug}/wiki`} className={btnGhostCls}>Alle Seiten</Link>
        {edit ? (
          <Link href={base} className={btnGhostCls}>Abbrechen</Link>
        ) : (
          mayEdit && <Link href={`${base}?edit=1`} className={btnGhostCls}>Bearbeiten</Link>
        )}
      </PageHeader>

      {edit && mayEdit ? (
        <Card title="Bearbeiten">
          <EditForm slug={slug} pageSlug={page.slug} title={page.title} body={page.body} />
        </Card>
      ) : (
        <Card>
          <article className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.body}</ReactMarkdown>
          </article>
        </Card>
      )}

      {proposals.map((p) => (
        <Card key={p.id} title={`Vorschlag von ${wikiAuthorLabel(p.author)} · ${formatDate(p.createdAt, true)}${p.note ? ` · ${p.note}` : ""}`}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-ink-400 dark:text-ink-200">Änderungen gegenüber der aktuellen Fassung</div>
              <pre className="max-h-[32rem] overflow-auto rounded-md border border-black/10 p-2 text-xs whitespace-pre-wrap dark:border-white/10">
                {lineDiff(page.body, p.body).map((l, i) => (
                  <div key={i} className={DIFF_CLS[l.op]}>
                    {l.op === "add" ? "+ " : l.op === "del" ? "- " : "  "}
                    {l.text || " "}
                  </div>
                ))}
              </pre>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-ink-400 dark:text-ink-200">Vorschlag (Vorschau)</div>
              <article className="prose prose-sm max-h-[32rem] max-w-none overflow-auto rounded-md border border-black/10 p-3 dark:border-white/10 dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.body}</ReactMarkdown>
              </article>
            </div>
          </div>
          {mayEdit && <div className="mt-3 flex gap-2">
            <form action={applyProposal.bind(null, slug, page.slug, p.id)}>
              <SubmitButton pending="…" confirm="Vorschlag übernehmen? Die aktuelle Fassung bleibt in der Historie.">Übernehmen</SubmitButton>
            </form>
            <form action={rejectProposal.bind(null, slug, page.slug, p.id)}>
              <SubmitButton ghost pending="…">Verwerfen</SubmitButton>
            </form>
          </div>}
        </Card>
      ))}

      {mayEdit && <div className="grid gap-4 md:grid-cols-2">
        <Card title="LLM-Vorschlag">
          <p className="mb-2 text-xs text-ink-400 dark:text-ink-200">
            Das lokale Modell liest diese Seite und passende Abschnitte aus der Wissensbasis von {ws.name} und schlägt eine
            überarbeitete Fassung vor. Nichts wird automatisch übernommen.
          </p>
          <ProposeForm slug={slug} pageSlug={page.slug} />
        </Card>
        <Card title="Wissensbasis">
          <p className="mb-2 text-xs text-ink-400 dark:text-ink-200">Diese Seite als Quelle für Fragen im Bereich „Wissen“ verwenden (ersetzt die vorige Fassung).</p>
          <IndexWikiButton slug={slug} pageSlug={page.slug} />
        </Card>
      </div>}

      <Card title="Versionshistorie">
        <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
          {history.map((r) => (
            <li key={r.id} className="py-1.5">
              <details>
                <summary className="cursor-pointer">
                  <span className="text-ink-400 dark:text-ink-200">{formatDate(r.createdAt, true)}</span> · <span title={r.author}>{wikiAuthorLabel(r.author)}</span> ·{" "}
                  <span className={r.status === "rejected" ? "text-red-600" : "text-green-700 dark:text-green-500"}>
                    {r.status === "rejected" ? "verworfen" : "übernommen"}
                  </span>
                  {r.note && <span className="text-ink-400 dark:text-ink-200"> · {r.note}</span>}
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-black/5 p-2 text-xs whitespace-pre-wrap dark:bg-white/5">{r.body}</pre>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
