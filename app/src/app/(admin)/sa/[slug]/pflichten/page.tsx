import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { FRAMEWORK_LABEL, type Framework } from "@/lib/compliance-catalog";
import type { AutoResult } from "@/lib/compliance-checks";
import { Badge, Card, Empty, PageHeader, btnCls } from "@/components/ui";
import { adoptCatalog, runChecks, saveItem } from "./actions";
import { ItemForm, RunChecksButton } from "./forms";

export const dynamic = "force-dynamic";

const STATUS_TONE = { OPEN: "warn", IN_PROGRESS: "accent", DONE: "ok", N_A: "neutral" } as const;
const STATUS_LABEL = { OPEN: "Offen", IN_PROGRESS: "In Arbeit", DONE: "Erledigt", N_A: "Nicht relevant" } as const;

export default async function PflichtenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const mayEdit = can(access, "compliance", "edit");
  const items = await db.complianceItem.findMany({ where: { workspaceId: ws.id }, orderBy: [{ framework: "asc" }, { key: "asc" }] });
  const groups = new Map<string, typeof items>();
  for (const i of items) groups.set(i.framework, [...(groups.get(i.framework) ?? []), i]);
  const done = items.filter((i) => i.status === "DONE" || i.status === "N_A").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pflichten"
        description="Rechtliche und technische Pflichten im Überblick. Hinweise Stand 10/2026 – vor Umsetzung prüfen, keine Rechtsberatung."
      >
        {mayEdit && (
          <form action={adoptCatalog.bind(null, slug)}>
            <button className={btnCls}>{items.length ? "Katalog aktualisieren" : "Katalog übernehmen"}</button>
          </form>
        )}
      </PageHeader>

      {items.length === 0 ? (
        <Card><Empty>Noch keine Pflichten angelegt. „Katalog übernehmen“ legt die Standardpunkte an.</Empty></Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-[15px]"><span className="font-display text-2xl tabular-nums">{done} / {items.length}</span> erledigt oder nicht relevant</p>
              {mayEdit && <RunChecksButton action={runChecks.bind(null, slug)} />}
            </div>
          </Card>
          {[...groups.entries()].map(([fw, list]) => (
            <Card key={fw} title={FRAMEWORK_LABEL[fw as Framework] ?? fw}>
              <ul className="divide-y divide-ink-100 dark:divide-white/10">
                {list.map((i) => {
                  const auto = i.autoResult as AutoResult | null;
                  const suggestion = auto?.ok === true ? "Erledigt" : auto?.ok === false ? "Offen" : undefined;
                  return (
                    <li key={i.id} className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="max-w-prose">
                          <h3 className="font-medium text-ink-900 dark:text-ink-50">{i.title}</h3>
                          {i.description && <p className="mt-0.5 text-[15px] text-ink-600 dark:text-ink-200">{i.description}</p>}
                        </div>
                        <Badge tone={STATUS_TONE[i.status as keyof typeof STATUS_TONE] ?? "neutral"}>{STATUS_LABEL[i.status as keyof typeof STATUS_LABEL] ?? i.status}</Badge>
                      </div>
                      {auto && (
                        <div className="mt-2 rounded-md bg-sand-100 px-3 py-2 text-sm dark:bg-white/5">
                          <span className="font-medium">Automatische Prüfung: </span>
                          <Badge tone={auto.ok === true ? "ok" : auto.ok === false ? "bad" : "neutral"}>{auto.ok === true ? "bestanden" : auto.ok === false ? "nicht bestanden" : "Hinweis"}</Badge>{" "}
                          {auto.summary}
                          {auto.details && auto.details.length > 0 && (
                            <ul className="mt-1 list-disc pl-5 font-mono text-xs break-all text-ink-600 dark:text-ink-200">
                              {auto.details.slice(0, 5).map((d) => <li key={d}>{d}</li>)}
                            </ul>
                          )}
                          <span className="ml-1 text-xs text-ink-400">({new Date(auto.checkedAt).toLocaleString("de-DE")})</span>
                        </div>
                      )}
                      {mayEdit && <ItemForm
                        id={i.id}
                        action={saveItem.bind(null, slug, i.id)}
                        status={i.status}
                        evidence={i.evidence}
                        dueAt={i.dueAt ? i.dueAt.toISOString().slice(0, 10) : ""}
                        suggestion={suggestion !== undefined && suggestion !== STATUS_LABEL[i.status as keyof typeof STATUS_LABEL] ? suggestion : undefined}
                      />}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
