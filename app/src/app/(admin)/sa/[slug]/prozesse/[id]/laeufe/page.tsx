import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/workspace";
import { pageAccess } from "@/lib/permissions/guard";
import { OBJECT_LABELS, type ObjectType } from "@/lib/process/definition";
import { Badge, btnGhostCls, Card, Empty, PageHeader } from "@/components/ui";
import { RUN_STATUS } from "@/components/process/RunTimeline";
import { objectHref } from "../../links";

export const dynamic = "force-dynamic";

const STATUSES = ["running", "waiting", "done", "goal_met", "failed", "cancelled"] as const;
const PAGE = 50;

export default async function LaeufePage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ status?: string; test?: string; seite?: string }> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const { ws } = await pageAccess(slug);
  const process = await db.process.findFirst({ where: { id, workspaceId: ws.id }, select: { id: true, name: true, objectType: true } });
  if (!process) notFound();

  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status : undefined;
  const test = sp.test === "1";
  const page = Math.max(1, Math.min(1000, Number(sp.seite) || 1));
  const where = { processId: id, workspaceId: ws.id, test, ...(status ? { status } : {}) };
  const [runs, total, counts] = await Promise.all([
    db.processRun.findMany({ where, orderBy: { startedAt: "desc" }, take: PAGE, skip: (page - 1) * PAGE, include: { version: { select: { version: true } } } }),
    db.processRun.count({ where }),
    db.processRun.groupBy({ by: ["status"], where: { processId: id, workspaceId: ws.id, test }, _count: true }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const q = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status, test: test ? "1" : undefined, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-5">
      <nav aria-label="Brotkrumen" className="text-sm">
        <Link href={`/sa/${slug}/prozesse/${id}`} className="text-accent-500 hover:underline dark:text-accent-100">
          ← Zurück zum Editor
        </Link>
      </nav>
      <PageHeader title={`Läufe: ${process.name}`} description={`Jeder Durchlauf eines ${OBJECT_LABELS[process.objectType as ObjectType] ?? "Datensatzes"} mit Schritt-Protokoll.`} />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter">
        <Link href={`/sa/${slug}/prozesse/${id}/laeufe${q({ status: undefined, seite: undefined })}`} className={`${btnGhostCls} ${!status ? "!border-accent-500" : ""}`}>
          Alle
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/sa/${slug}/prozesse/${id}/laeufe${q({ status: s, seite: undefined })}`} className={`${btnGhostCls} ${status === s ? "!border-accent-500" : ""}`} aria-current={status === s ? "true" : undefined}>
            {RUN_STATUS[s].label} ({count(s)})
          </Link>
        ))}
        <Link href={`/sa/${slug}/prozesse/${id}/laeufe${q({ test: test ? undefined : "1", seite: undefined })}`} className="ml-auto text-sm text-accent-500 hover:underline dark:text-accent-100">
          {test ? "Echte Läufe zeigen" : "Testläufe zeigen"}
        </Link>
      </div>

      <Card>
        {runs.length === 0 ? (
          <Empty>Keine Läufe für diesen Filter.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead className="text-sm text-ink-400 dark:text-ink-200">
                <tr className="border-b border-ink-100 dark:border-white/10">
                  <th className="py-2 pr-3 font-medium">Gestartet</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Datensatz</th>
                  <th className="py-2 pr-3 font-medium">Version</th>
                  <th className="py-2 pr-3 font-medium">Hinweis</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const st = RUN_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
                  const href = objectHref(slug, r.objectType, r.objectId);
                  return (
                    <tr key={r.id} className="border-b border-ink-100 last:border-0 dark:border-white/10">
                      <td className="py-2 pr-3">
                        <Link href={`/sa/${slug}/prozesse/${id}/laeufe/${r.id}`} className="font-medium hover:underline">
                          {formatDate(r.startedAt, true)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="py-2 pr-3">
                        {href ? (
                          <Link href={href} className="text-accent-500 hover:underline dark:text-accent-100">
                            {OBJECT_LABELS[r.objectType as ObjectType] ?? r.objectType} öffnen
                          </Link>
                        ) : (
                          <span className="font-mono text-sm">{r.objectId}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">v{r.version.version}</td>
                      <td className="max-w-xs truncate py-2 pr-3 text-sm text-red-700 dark:text-red-300" title={r.error ?? undefined}>
                        {r.error ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-ink-400">
              Seite {page} von {Math.ceil(total / PAGE)} · {formatNumber(total)} Läufe
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link className={btnGhostCls} href={`/sa/${slug}/prozesse/${id}/laeufe${q({ seite: String(page - 1) })}`}>
                  Zurück
                </Link>
              )}
              {page * PAGE < total && (
                <Link className={btnGhostCls} href={`/sa/${slug}/prozesse/${id}/laeufe${q({ seite: String(page + 1) })}`}>
                  Weiter
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
