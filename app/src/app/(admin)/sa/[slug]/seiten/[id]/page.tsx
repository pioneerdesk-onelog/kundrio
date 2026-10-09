import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { LANG_NAMES, publicPath } from "@/lib/p-meta";
import type { A11yReport } from "@/lib/p-a11y";
import { Badge, Card, PageHeader, btnDangerCls, btnGhostCls } from "@/components/ui";
import { createTranslation, deletePage, publishPage, unpublishPage, updateSeo } from "../actions";
import { PublishButton, RefreshWhilePending, SeoForm, TranslateForm } from "../forms";
import { jobLabel, pageJobs } from "../jobs";

export const dynamic = "force-dynamic";

export default async function SeiteDetail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { ws, access } = await pageAccess(slug);
  const page = await db.landingPage.findFirst({ where: { id, workspaceId: ws.id } });
  if (!page) notFound();
  const [siblings, jobs] = await Promise.all([
    db.landingPage.findMany({ where: { workspaceId: ws.id, groupId: page.groupId, NOT: { id } }, select: { id: true, lang: true, title: true, status: true } }),
    pageJobs(ws.id),
  ]);
  const job = jobs.get(page.id);
  const jl = jobLabel(job);
  const langs = (ws.languages.length ? ws.languages : ["de"]).filter((l) => l !== page.lang && !siblings.some((s) => s.lang === l));
  const report = page.a11yReport as A11yReport | null;
  const changedSincePublish = page.status === "PUBLISHED" && JSON.stringify(page.data) !== JSON.stringify(page.publishedData);

  return (
    <div className="space-y-6">
      <RefreshWhilePending pending={job?.status === "queued" || job?.status === "running"} />
      <PageHeader title={page.title} description={`/${page.lang}/${page.slug}`}>
        {can(access, "pages", "edit") && <Link href={`/sa/${slug}/seiten/${page.id}/editor`} className={btnGhostCls}>Im Editor bearbeiten</Link>}
        {page.status === "PUBLISHED" && <a href={publicPath(slug, page.lang, page.slug)} target="_blank" rel="noopener" className={btnGhostCls}>Ansehen ↗</a>}
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {page.status === "PUBLISHED" ? <Badge tone="ok">veröffentlicht {formatDate(page.publishedAt, true)} von {page.publishedBy}</Badge> : <Badge>Entwurf</Badge>}
        {changedSincePublish && <Badge tone="warn">Entwurf hat unveröffentlichte Änderungen</Badge>}
        {page.aiGenerated && <Badge tone="accent">KI-unterstützt (Hinweis erscheint im Seitenfuß)</Badge>}
        {jl && <Badge tone={jl.tone}>{jl.text}</Badge>}
      </div>
      {job?.status === "failed" && job.lastError && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">KI-Auftrag fehlgeschlagen: {job.lastError}</p>
      )}

      {!can(access, "pages", "edit") && <p className="text-[15px] text-ink-600 dark:text-ink-200">Nur Ansicht – zum Bearbeiten fehlt die Berechtigung.</p>}
      {can(access, "pages", "edit") && <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Veröffentlichen">
          <p className="mb-3 text-[15px] text-ink-600 dark:text-ink-200">Vor dem Veröffentlichen wird die Seite auf Barrierefreiheit (WCAG 2.2 AA, Auswahl) geprüft. Fehler blockieren, Hinweise nicht.</p>
          <div className="flex flex-wrap items-start gap-3">
            <PublishButton action={publishPage.bind(null, slug, page.id)} label={page.status === "PUBLISHED" ? "Änderungen veröffentlichen" : "Prüfen und veröffentlichen"} />
            {page.status === "PUBLISHED" && (
              <form action={unpublishPage.bind(null, slug, page.id)}><button className={btnGhostCls}>Zurückziehen</button></form>
            )}
          </div>
          {report && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Prüfbericht vom {formatDate(new Date(report.checkedAt), true)}: {report.errors} Fehler, {report.warnings} Hinweise</h3>
              {report.issues.length === 0 ? (
                <p className="text-sm text-emerald-800 dark:text-emerald-300">Keine Auffälligkeiten.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {report.issues.map((i, n) => (
                    <li key={n} className="flex gap-2">
                      <Badge tone={i.level === "error" ? "bad" : "warn"}>{i.level === "error" ? "Fehler" : "Hinweis"}</Badge>
                      <span>{i.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        <Card title="Titel, Adresse und SEO">
          <SeoForm action={updateSeo.bind(null, slug, page.id)} page={page} />
        </Card>

        <Card title="Sprachfassungen">
          {siblings.length > 0 && (
            <ul className="mb-4 space-y-1 text-[15px]">
              {siblings.map((s) => (
                <li key={s.id}>
                  <Link className="text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/seiten/${s.id}`}>{LANG_NAMES[s.lang] ?? s.lang}: {s.title}</Link>{" "}
                  {s.status === "PUBLISHED" ? <Badge tone="ok">veröffentlicht</Badge> : <Badge>Entwurf</Badge>}
                </li>
              ))}
            </ul>
          )}
          <TranslateForm action={createTranslation.bind(null, slug, page.id)} langs={langs} names={LANG_NAMES} />
        </Card>

        {can(access, "pages", "delete") && (
          <Card title="Löschen">
            <p className="mb-3 text-[15px] text-ink-600 dark:text-ink-200">Löscht nur diese Sprachfassung. Nicht rückgängig zu machen.</p>
            <form action={deletePage.bind(null, slug, page.id)}><button className={btnDangerCls}>Seite löschen</button></form>
          </Card>
        )}
      </div>}
    </div>
  );
}
