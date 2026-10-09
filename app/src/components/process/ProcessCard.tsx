import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can, type Access } from "@/lib/permissions";
import { definitionSchema, NODE_TYPES, TRIGGER_TYPES, type ObjectType } from "@/lib/process/definition";
import { evalGroup } from "@/lib/process/conditions";
import { loadState } from "@/lib/process/state";
import { Badge, Card, Empty } from "@/components/ui";

const RUN_STATUS: Record<string, { label: string; tone: "ok" | "neutral" | "warn" | "bad" | "accent" }> = {
  running: { label: "läuft", tone: "accent" },
  waiting: { label: "wartet", tone: "warn" },
  done: { label: "fertig", tone: "ok" },
  goal_met: { label: "Ziel erreicht", tone: "ok" },
  failed: { label: "Fehler", tone: "bad" },
  cancelled: { label: "abgebrochen", tone: "neutral" },
};

/**
 * Karte „Prozesse“ auf Detailseiten: Läufe dieses Datensatzes und aktive Prozesse, die zu ihm passen.
 * Nur sichtbar mit Leserecht auf Prozesse.
 */
export async function ProcessCard({ slug, workspaceId, objectType, objectId, access }: { slug: string; workspaceId: string; objectType: ObjectType; objectId: string; access: Access }) {
  if (!can(access, "processes", "read")) return null;
  const [runs, active, loaded] = await Promise.all([
    db.processRun.findMany({
      where: { workspaceId, objectType, objectId },
      orderBy: { startedAt: "desc" },
      take: 10,
      include: { process: { select: { id: true, name: true } }, version: { select: { definition: true } } },
    }),
    db.process.findMany({
      where: { workspaceId, objectType, status: "ACTIVE", activeVersionId: { not: null } },
      select: { id: true, name: true, activeVersionId: true, versions: { select: { id: true, definition: true } } },
      orderBy: { name: "asc" },
    }),
    loadState(workspaceId, objectType, objectId),
  ]);

  // Passende aktive Prozesse: Einschreibungsfilter gegen den aktuellen Zustand
  const matches = active
    .map((p) => {
      const parsed = definitionSchema.safeParse(p.versions.find((v) => v.id === p.activeVersionId)?.definition);
      if (!parsed.success) return null;
      const def = parsed.data;
      const ok = loaded ? evalGroup(loaded.state, def.enrollment.filters) : false;
      return { id: p.id, name: p.name, trigger: TRIGGER_TYPES[def.trigger.type].label, filtersOk: ok };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  const stepLabel = (def: unknown, nodeId: string | null) => {
    if (!nodeId) return null;
    const parsed = definitionSchema.safeParse(def);
    const n = parsed.success ? parsed.data.nodes.find((x) => x.id === nodeId) : undefined;
    return n ? n.label || NODE_TYPES[n.type].label : null;
  };

  return (
    <Card title="Prozesse">
      <h3 className="mb-2 text-sm font-semibold text-ink-800 dark:text-ink-100">Läufe dieses Datensatzes</h3>
      {runs.length === 0 ? (
        <Empty>Noch kein Prozess ist für diesen Datensatz gelaufen.</Empty>
      ) : (
        <ul className="divide-y divide-ink-100 text-[15px] dark:divide-white/10">
          {runs.map((r) => {
            const st = RUN_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
            const step = stepLabel(r.version.definition, r.currentNodeId);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/sa/${slug}/prozesse/${r.process.id}/laeufe/${r.id}`} className="font-medium text-ink-900 hover:underline dark:text-ink-50">
                    {r.process.name}
                  </Link>
                  {r.test && <span className="ml-1 text-sm text-ink-400">(Test)</span>}
                  {step && r.status !== "done" && <span className="block text-sm text-ink-400 dark:text-ink-200">aktueller Schritt: {step}</span>}
                  {r.error && <span className="block text-sm text-red-700 dark:text-red-300">{r.error}</span>}
                </span>
                <span className="flex items-center gap-2 text-sm text-ink-400 dark:text-ink-200">
                  {formatDate(r.startedAt, true)} <Badge tone={st.tone}>{st.label}</Badge>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="mb-2 mt-4 text-sm font-semibold text-ink-800 dark:text-ink-100">Passt zu folgenden aktiven Prozessen</h3>
      {matches.length === 0 ? (
        <Empty>Kein aktiver Prozess für diesen Objekttyp.</Empty>
      ) : (
        <ul className="space-y-1 text-[15px]">
          {matches.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/sa/${slug}/prozesse/${m.id}`} className="hover:underline">
                {m.name}
              </Link>
              <span className="text-sm text-ink-400 dark:text-ink-200">
                startet bei „{m.trigger}“ · {m.filtersOk ? <Badge tone="ok">Filter erfüllt</Badge> : <Badge tone="neutral">Filter derzeit nicht erfüllt</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
