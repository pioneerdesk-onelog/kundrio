import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { LANG_NAMES, publicPath } from "@/lib/p-meta";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { createAiDraft, createPage } from "./actions";
import { AiDraftForm, CreatePageForm, RefreshWhilePending } from "./forms";
import { jobLabel, pageJobs } from "./jobs";

export const dynamic = "force-dynamic";

export default async function SeitenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const langs = ws.languages.length ? ws.languages : ["de"];
  const [pages, jobs] = await Promise.all([
    db.landingPage.findMany({
      where: { workspaceId: ws.id },
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true, groupId: true, slug: true, lang: true, title: true, status: true, aiGenerated: true, updatedAt: true, publishedAt: true, a11yReport: true },
    }),
    pageJobs(ws.id),
  ]);

  // Sprachfassungen gruppieren (Reihenfolge: zuletzt bearbeitet)
  const groups = new Map<string, typeof pages>();
  for (const p of pages) groups.set(p.groupId, [...(groups.get(p.groupId) ?? []), p]);
  const anyPending = [...jobs.values()].some((j) => j.status === "queued" || j.status === "running");

  return (
    <div className="space-y-6">
      <RefreshWhilePending pending={anyPending} />
      <PageHeader title="Landingpages" description="Seiten im Branding dieses Sub-Accounts. Veröffentlicht wird erst nach der Barrierefreiheits-Prüfung." />

      <Card title={`Seiten (${pages.length})`}>
        {pages.length === 0 ? (
          <Empty>Noch keine Landingpage. Legen Sie unten eine an.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {[...groups.values()].map((variants) => (
              <li key={variants[0].groupId} className="py-3">
                {variants.map((p) => {
                  const job = jobLabel(jobs.get(p.id));
                  const report = p.a11yReport as { errors?: number; warnings?: number } | null;
                  return (
                    <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
                      <Link href={`/sa/${slug}/seiten/${p.id}`} className="font-medium text-ink-900 hover:underline dark:text-ink-50">{p.title}</Link>
                      <Badge>{LANG_NAMES[p.lang] ?? p.lang}</Badge>
                      {p.status === "PUBLISHED" ? <Badge tone="ok">veröffentlicht</Badge> : <Badge>Entwurf</Badge>}
                      {p.aiGenerated && <Badge tone="accent">KI-unterstützt</Badge>}
                      {report && (report.errors ?? 0) > 0 && <Badge tone="bad">{report.errors} A11y-Fehler</Badge>}
                      {job && <Badge tone={job.tone}>{job.text}</Badge>}
                      <span className="text-sm text-ink-400 dark:text-ink-200">/{p.lang}/{p.slug} · bearbeitet {formatDate(p.updatedAt, true)}</span>
                      <span className="ml-auto flex gap-3 text-sm">
                        <Link className="text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/seiten/${p.id}/editor`}>Bearbeiten</Link>
                        {p.status === "PUBLISHED" && (
                          <a className="text-accent-500 hover:underline dark:text-accent-100" href={publicPath(slug, p.lang, p.slug)} target="_blank" rel="noopener">Ansehen ↗</a>
                        )}
                      </span>
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        )}
        {anyPending && <p className="mt-3 text-sm text-ink-400 dark:text-ink-200">KI-Aufträge laufen im Hintergrund-Worker (<code>npm run worker</code>). Diese Seite aktualisiert sich automatisch.</p>}
      </Card>

      {can(access, "pages", "edit") && <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Neue Seite">
          <CreatePageForm action={createPage.bind(null, slug)} langs={langs} names={LANG_NAMES} />
        </Card>
        <Card title="Entwurf mit KI">
          <AiDraftForm action={createAiDraft.bind(null, slug)} langs={langs} names={LANG_NAMES} />
        </Card>
      </div>}

      <Card title="Für Suchmaschinen und KI-Assistenten">
        <ul className="list-inside list-disc space-y-1 text-[15px]">
          <li><a className="text-accent-500 underline dark:text-accent-100" href={`/p/${slug}/sitemap.xml`} target="_blank" rel="noopener">Sitemap</a> – alle veröffentlichten Seiten mit Sprachfassungen</li>
          <li><a className="text-accent-500 underline dark:text-accent-100" href={`/p/${slug}/llms.txt`} target="_blank" rel="noopener">llms.txt</a> – Kurzüberblick für KI-Assistenten</li>
          <li><a className="text-accent-500 underline dark:text-accent-100" href={`/p/${slug}/robots.txt`} target="_blank" rel="noopener">robots.txt</a> – KI-Crawler sind erlaubt</li>
        </ul>
      </Card>
    </div>
  );
}
