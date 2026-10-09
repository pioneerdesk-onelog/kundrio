"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyNodeChanges, Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeChange } from "@xyflow/react";
import { LayoutGrid, ShieldCheck } from "lucide-react";
import { definitionSchema, OUTPUT_LABELS, outputsOf, validateDefinition, type NodeType, type ObjectType, type ProcessDefinition, type ProcessNode } from "@/lib/process/definition";
import { autoLayout, changedNodeIds, deleteNode, insertNode, triggerChanged, triggerPosition, TRIGGER_ID } from "@/lib/process-ui/graph";
import { nodeSummary, triggerSummary, type Lookup } from "@/lib/process-ui/summary";
import { describeProcess } from "@/lib/process-ui/sentence";
import { allFields, checkReferences } from "@/lib/process/fields";
import { Badge, btnCls, btnGhostCls } from "@/components/ui";
import { AddMenu } from "./AddMenu";
import { CanvasContext, edgeTypes, nodeTypes, type PlusRFEdge, type StepRFNode, type TriggerRFNode } from "./canvas";
import { Issues, NodePanel, TriggerPanel } from "./panels";
import { TestRun } from "./TestRun";
import type { ActionResult, EditorOptions, RunView } from "./types";

type Props = {
  processId: string;
  name: string;
  status: string;
  objectType: ObjectType;
  draft: ProcessDefinition;
  active: ProcessDefinition | null;
  activeVersion: number | null;
  options: EditorOptions;
  /** Rechte des Benutzers (fehlende Rechte blenden Bedienelemente aus; Server prüft zusätzlich) */
  can?: { edit: boolean; publish: boolean; archive: boolean };
  /** Anzeige „Wer darf was“: eigene Rechte + Rollen, die das standardmäßig dürfen */
  rights?: { items: { label: string; yes: boolean; roles: string[] }[] };
  actions: {
    save: (def: unknown) => Promise<ActionResult<{ version: number; ok: boolean }>>;
    publish: () => Promise<ActionResult<{ status: string }>>;
    setStatus: (s: "ACTIVE" | "PAUSED" | "ARCHIVED") => Promise<ActionResult<null>>;
    search: (objectType: string, q: string) => Promise<ActionResult<{ id: string; label: string }[]>>;
    testRun: (objectId: string) => Promise<ActionResult<{ runId: string }>>;
    getRun: (runId: string) => Promise<ActionResult<RunView>>;
  };
};

type Tab = "config" | "check" | "test";
type Flash = { tone: "ok" | "bad" | "info"; text: string } | null;

const STATUS_LABEL: Record<string, { label: string; tone: "ok" | "neutral" | "warn" }> = {
  DRAFT: { label: "Entwurf", tone: "neutral" },
  ACTIVE: { label: "Aktiv", tone: "ok" },
  PAUSED: { label: "Pausiert", tone: "warn" },
  ARCHIVED: { label: "Archiv", tone: "neutral" },
};

function needsLayout(def: ProcessDefinition) {
  return def.nodes.length > 1 && def.nodes.every((n) => n.position.x === 0 && n.position.y === 0);
}

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}

function Editor({ name, status, objectType, draft, active, activeVersion, options, actions, rights, can = { edit: true, publish: true, archive: true } }: Props) {
  const [view, setView] = useState<"flow" | "words">("flow");
  const router = useRouter();
  const rf = useReactFlow();
  // Ohne gespeicherte Positionen einmal automatisch anordnen; als Ausgangsstand für „ungespeichert“ merken
  const [initial] = useState<ProcessDefinition>(() => (needsLayout(draft) || draft.nodes.every((n) => n.position.y === 0) ? autoLayout(draft) : draft));
  const [def, setDef] = useState<ProcessDefinition>(initial);
  const saved = useRef(JSON.stringify(initial));
  const [selected, setSelected] = useState<string | null>(TRIGGER_ID);
  const [tab, setTab] = useState<Tab>("config");
  const [adding, setAdding] = useState<{ from: string; output: string } | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(def) !== saved.current;

  // Warnung beim Verlassen mit ungespeicherten Änderungen
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Live-Prüfung: Struktur + Referenzen gegen den Feld-Katalog des Sub-Accounts (gleiche Logik wie der Server)
  const validation = useMemo(() => {
    const base = validateDefinition(def, objectType);
    // Unlesbare Struktur: Referenzprüfung würde nur Folgefehler liefern
    if (!definitionSchema.safeParse(def).success) return base;
    const refs = checkReferences(options.catalog, objectType, def);
    const issues = [...base.issues, ...refs];
    return { ok: !issues.some((i) => i.level === "error"), external: base.external, issues };
  }, [def, objectType, options.catalog]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, typeof validation.issues>();
    for (const i of validation.issues) if (i.nodeId) m.set(i.nodeId, [...(m.get(i.nodeId) ?? []), i]);
    return m;
  }, [validation]);
  // Stabil halten (useMemo): ein bei jedem Rendern neues Array ließ `build` → setRfNodes endlos neu laufen (React #185)
  const generalIssues = useMemo(() => validation.issues.filter((i) => !i.nodeId), [validation]);
  const changed = useMemo(() => changedNodeIds(def, active), [def, active]);

  const lookup: Lookup = useMemo(() => {
    const maps = {
      list: options.lists,
      stage: options.stages,
      lifecycle: options.lifecycleStages,
      template: options.templates,
      webhook: options.webhooks,
      user: options.users,
      form: options.forms,
      meetingType: options.catalog.meetingTypes ?? [],
      field: allFields(options.catalog, objectType, def).map((f) => ({ value: f.path, label: f.label })),
    };
    return { label: (kind, value) => maps[kind].find((o) => o.value === value)?.label ?? value };
  }, [options, objectType, def]);
  const sentences = useMemo(() => (view === "words" ? describeProcess(def, objectType, lookup) : []), [view, def, objectType, lookup]);

  const labels = useMemo(() => Object.fromEntries(def.nodes.map((n) => [n.id, n.label || nodeSummary(n, lookup) || n.type])), [def.nodes, lookup]);

  // React-Flow-Knoten aus der Definition ableiten; Messwerte (Größe) bleiben erhalten
  const build = useCallback((): Node[] => {
    const ts = triggerSummary(def, lookup);
    const trigger: TriggerRFNode = {
      id: TRIGGER_ID,
      type: "trigger",
      position: triggerPosition(def),
      draggable: false,
      deletable: false,
      data: {
        title: ts.title,
        summary: ts.summary,
        filterCount: def.enrollment.filters.conditions.length,
        reenroll: def.enrollment.reenroll,
        hasGoal: Boolean(def.goal),
        changed: triggerChanged(def, active),
        issues: generalIssues.filter((i) => i.level === "error").length,
      },
      selected: selected === TRIGGER_ID,
    };
    const steps: StepRFNode[] = def.nodes.map((n) => ({
      id: n.id,
      type: "step",
      position: n.position,
      deletable: false,
      selected: selected === n.id,
      ariaLabel: `${n.label || n.type}. Enter zum Bearbeiten, Entf zum Löschen.`,
      data: { node: n, summary: nodeSummary(n, lookup), freeOutputs: outputsOf(n.type).filter((o) => !def.edges.some((e) => e.from === n.id && e.output === o)) },
    }));
    return [trigger, ...steps];
  }, [def, lookup, selected, active, generalIssues]);

  const [rfNodes, setRfNodes] = useState<Node[]>(build);
  useEffect(() => {
    setRfNodes((prev) => build().map((n) => ({ ...n, measured: prev.find((p) => p.id === n.id)?.measured })));
  }, [build]);

  const rfEdges: PlusRFEdge[] = useMemo(() => {
    const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#7a8591" };
    const list: PlusRFEdge[] = def.start
      ? [{ id: `${TRIGGER_ID}:next`, source: TRIGGER_ID, sourceHandle: "next", target: def.start, type: "plus", data: { from: TRIGGER_ID, output: "next" }, markerEnd: marker }]
      : [];
    for (const e of def.edges) {
      list.push({
        id: `${e.from}:${e.output}`,
        source: e.from,
        sourceHandle: e.output,
        target: e.to,
        type: "plus",
        markerEnd: marker,
        data: { from: e.from, output: e.output, label: e.output !== "next" ? OUTPUT_LABELS[e.output] ?? e.output : undefined },
      });
    }
    return list;
  }, [def]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
    for (const c of changes) {
      if (c.type === "select" && c.selected) {
        setSelected(c.id);
        setTab("config");
      }
    }
  }, []);

  const select = (id: string | null) => {
    setSelected(id);
    if (id) setTab("config");
  };

  const add = useCallback((from: string, output: string) => setAdding({ from, output }), []);

  const pick = (type: NodeType) => {
    if (!adding) return;
    const r = insertNode(def, adding, type);
    setDef(r.def);
    setAdding(null);
    select(r.id);
  };

  const removeNode = (id: string) => {
    setDef((d) => deleteNode(d, id));
    select(TRIGGER_ID);
  };

  const updateNode = (n: ProcessNode) => setDef((d) => ({ ...d, nodes: d.nodes.map((x) => (x.id === n.id ? n : x)) }));

  const relayout = () => {
    setDef((d) => autoLayout(d));
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50);
  };

  const save = async (): Promise<boolean> => {
    const r = await actions.save(def);
    if (!r.ok) {
      setFlash({ tone: "bad", text: r.error });
      return false;
    }
    saved.current = JSON.stringify(def);
    setFlash({ tone: r.data.ok ? "ok" : "info", text: r.message ?? "Gespeichert." });
    return true;
  };

  const onSave = () => startTransition(async () => void (await save()));

  const onPublish = () =>
    startTransition(async () => {
      if (!validation.ok) {
        setFlash({ tone: "bad", text: "Der Entwurf hat noch Fehler (siehe Reiter „Prüfung“)." });
        setTab("check");
        return;
      }
      if (dirty && !(await save())) return;
      const r = await actions.publish();
      setFlash(r.ok ? { tone: "ok", text: r.message ?? "Veröffentlicht." } : { tone: "bad", text: r.error });
      router.refresh();
    });

  const onStatus = (s: "ACTIVE" | "PAUSED" | "ARCHIVED") =>
    startTransition(async () => {
      if (s === "ARCHIVED" && !confirm("Prozess archivieren? Laufende Durchläufe werden beendet.")) return;
      const r = await actions.setStatus(s);
      setFlash(r.ok ? { tone: "ok", text: r.message ?? "Gespeichert." } : { tone: "bad", text: r.error });
      router.refresh();
    });

  // Tastatur: Entf/Rücktaste löscht den gewählten Schritt (mit Bestätigung), Esc hebt Auswahl auf
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selected && selected !== TRIGGER_ID) {
      const n = def.nodes.find((x) => x.id === selected);
      if (n && confirm(`Schritt „${labels[n.id]}“ löschen?`)) removeNode(n.id);
      e.preventDefault();
    }
    if (e.key === "Escape") select(null);
  };

  const node = def.nodes.find((n) => n.id === selected);
  const st = STATUS_LABEL[status] ?? { label: status, tone: "neutral" as const };
  const errorCount = validation.issues.filter((i) => i.level === "error").length;

  return (
    <div className="space-y-3">
      <p className="rounded-md bg-amber-50 px-3 py-2 text-[15px] text-amber-900 lg:hidden">Der Prozess-Editor ist für Bildschirme ab etwa 1024 px Breite gedacht. Auf kleineren Geräten lässt er sich nur eingeschränkt bedienen.</p>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 font-display text-2xl text-ink-900 dark:text-ink-50">{name}</h1>
        <Badge tone={st.tone}>{st.label}</Badge>
        {activeVersion && <Badge tone="neutral">v{activeVersion} live</Badge>}
        {validation.external && <Badge tone="warn">Außenwirkung – Freigabe nötig</Badge>}
        {dirty ? <Badge tone="warn">ungespeichert</Badge> : <Badge tone="ok">gespeichert</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          <div role="group" aria-label="Ansicht" className="inline-flex overflow-hidden rounded-md border border-ink-200 dark:border-white/15">
            {(["flow", "words"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`px-3 py-2 text-sm ${view === v ? "bg-accent-500 font-medium text-white" : "bg-white text-ink-800 hover:bg-sand-100 dark:bg-transparent dark:text-ink-50"}`}
              >
                {v === "flow" ? "Fluss" : "In Worten"}
              </button>
            ))}
          </div>
          <button type="button" className={btnGhostCls} onClick={relayout} title="Schritte automatisch anordnen">
            <LayoutGrid size={15} aria-hidden /> Anordnen
          </button>
          {can.edit && (
            <button type="button" className={btnGhostCls} onClick={onSave} disabled={pending || !dirty}>
              Entwurf speichern
            </button>
          )}
          {can.edit && (
            <button type="button" className={btnCls} onClick={onPublish} disabled={pending}>
              {can.publish ? "Veröffentlichen" : "Zur Veröffentlichung einreichen"}
            </button>
          )}
          {can.edit && status === "ACTIVE" && (
            <button type="button" className={btnGhostCls} onClick={() => onStatus("PAUSED")} disabled={pending}>
              Pausieren
            </button>
          )}
          {can.publish && status === "PAUSED" && (
            <button type="button" className={btnGhostCls} onClick={() => onStatus("ACTIVE")} disabled={pending}>
              Fortsetzen
            </button>
          )}
          {can.archive && status !== "ARCHIVED" && (
            <button type="button" className={btnGhostCls} onClick={() => onStatus("ARCHIVED")} disabled={pending}>
              Archivieren
            </button>
          )}
        </div>
      </div>

      {rights && (
        <details className="rounded-lg border border-ink-100 bg-white px-3 py-2 text-[15px] dark:border-white/10 dark:bg-ink-900" open={!can.edit}>
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink-800 dark:text-ink-50">
            <ShieldCheck size={16} aria-hidden /> Ihre Rechte:{" "}
            {rights.items.map((r) => (
              <span key={r.label} className={r.yes ? "text-emerald-700 dark:text-emerald-300" : "text-ink-400 line-through"}>
                {r.label}
              </span>
            ))}
            {!can.edit && <Badge tone="neutral">schreibgeschützt</Badge>}
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-ink-600 dark:text-ink-200">
            {rights.items.map((r) => (
              <li key={r.label}>
                <strong className="font-medium text-ink-800 dark:text-ink-100">{r.label}</strong> – standardmäßig: {r.roles.length ? r.roles.join(", ") : "keine Rolle"} (sowie Agentur-Inhaber/-Admins). Anpassbar unter „Team → Rollen“.
              </li>
            ))}
          </ul>
        </details>
      )}

      {flash && (
        <p
          role={flash.tone === "bad" ? "alert" : "status"}
          className={`rounded-md px-3 py-2 text-[15px] ${
            flash.tone === "ok" ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200" : flash.tone === "bad" ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200" : "bg-sand-100 text-ink-800 dark:bg-white/5 dark:text-ink-100"
          }`}
        >
          {flash.text}
        </p>
      )}

      <div className="flex h-[calc(100vh-240px)] min-h-[560px] min-w-[900px] overflow-hidden rounded-xl border border-ink-100 bg-white dark:border-white/10 dark:bg-ink-900" onKeyDown={onKeyDown}>
        {view === "words" && (
          <div className="min-w-0 flex-1 overflow-y-auto bg-sand-50 p-6 dark:bg-ink-900" aria-label="Prozess in Worten">
            <h2 className="mb-3 font-display text-xl text-ink-900 dark:text-ink-50">So läuft der Prozess ab</h2>
            <ol className="space-y-1.5 text-[16px] leading-relaxed text-ink-800 dark:text-ink-100">
              {sentences.map((line, i) => (
                <li key={i} style={{ paddingLeft: `${line.depth * 1.25}rem` }}>
                  {line.nodeId ? (
                    <button type="button" className="text-left hover:underline" onClick={() => select(line.nodeId!)}>
                      {line.text}
                    </button>
                  ) : (
                    line.text
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className={`relative min-w-0 flex-1 bg-sand-50 dark:bg-ink-900 ${view === "words" ? "hidden" : ""}`} aria-label="Arbeitsfläche des Prozesses">
          <CanvasContext.Provider value={{ onAdd: add, issuesByNode, changed, readOnly: !can.edit }}>
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(_, n) => select(n.id)}
              onPaneClick={() => select(null)}
              onNodeDragStop={(_, n) => {
                if (n.id === TRIGGER_ID) return;
                setDef((d) => ({ ...d, nodes: d.nodes.map((x) => (x.id === n.id ? { ...x, position: n.position } : x)) }));
              }}
              deleteKeyCode={null}
              nodesConnectable={false}
              edgesFocusable={false}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.25}
              maxZoom={1.5}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </CanvasContext.Provider>
        </div>

        <aside className="flex w-[400px] shrink-0 flex-col border-l border-ink-100 dark:border-white/10" aria-label="Einstellungen">
          <div role="tablist" className="flex border-b border-ink-100 dark:border-white/10">
            {(
              [
                ["config", "Einstellungen"],
                ["check", `Prüfung${errorCount ? ` (${errorCount})` : ""}`],
                ["test", "Testlauf"],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                type="button"
                onClick={() => setTab(k)}
                className={`-mb-px flex-1 border-b-2 px-3 py-2.5 text-[15px] ${tab === k ? "border-accent-500 font-semibold text-ink-900 dark:text-ink-50" : "border-transparent text-ink-600 hover:text-ink-900 dark:text-ink-200"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4" role="tabpanel">
            {tab === "config" &&
              (selected === TRIGGER_ID ? (
                <TriggerPanel def={def} objectType={objectType} options={options} onChange={setDef} issues={generalIssues} readOnly={!can.edit} />
              ) : node ? (
                <NodePanel
                  key={node.id}
                  node={node}
                  def={def}
                  readOnly={!can.edit}
                  objectType={objectType}
                  options={options}
                  issues={issuesByNode.get(node.id) ?? []}
                  isStart={def.start === node.id}
                  hasErrorBranch={def.edges.some((e) => e.from === node.id && e.output === "error")}
                  onChange={updateNode}
                  onDelete={() => removeNode(node.id)}
                  onAddErrorBranch={() => add(node.id, "error")}
                />
              ) : (
                <div className="space-y-3 text-[15px] text-ink-600 dark:text-ink-200">
                  <p>Wählen Sie den Auslöser oder einen Schritt, um ihn zu bearbeiten.</p>
                  <p>Mit den „+“-Knöpfen auf den Verbindungen fügen Sie neue Schritte ein. Mit Tab erreichen Sie die Schritte per Tastatur, Entf löscht den gewählten Schritt.</p>
                </div>
              ))}
            {tab === "check" && (
              <div className="space-y-3">
                {validation.ok ? (
                  <p className="rounded-md bg-emerald-50 px-3 py-2 text-[15px] text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">Keine Fehler. Der Prozess kann veröffentlicht werden.</p>
                ) : (
                  <p className="text-[15px] text-ink-600 dark:text-ink-200">Diese Punkte verhindern das Veröffentlichen:</p>
                )}
                {validation.external && <p className="rounded-md bg-amber-50 px-3 py-2 text-[15px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Enthält Aktionen mit Außenwirkung (E-Mail/Webhook). Nach dem Veröffentlichen muss ein Admin die Version im Freigabe-Eingang bestätigen.</p>}
                <Issues issues={generalIssues} />
                {def.nodes
                  .filter((n) => issuesByNode.has(n.id))
                  .map((n) => (
                    <div key={n.id}>
                      <button type="button" className="mb-1 text-[15px] font-medium text-accent-600 hover:underline dark:text-accent-100" onClick={() => select(n.id)}>
                        {labels[n.id]}
                      </button>
                      <Issues issues={issuesByNode.get(n.id) ?? []} />
                    </div>
                  ))}
                {active && changed.size > 0 && <p className="text-sm text-ink-400 dark:text-ink-200">{changed.size} Schritt(e) weichen von der veröffentlichten Version ab (auf der Fläche als „geändert“ markiert).</p>}
              </div>
            )}
            {tab === "test" && (
              <TestRun
                objectType={objectType}
                search={actions.search}
                start={actions.testRun}
                poll={actions.getRun}
                labels={labels}
                beforeStart={async () => (dirty ? save() : true)}
              />
            )}
          </div>
        </aside>
      </div>

      {adding && <AddMenu output={adding.output} onPick={pick} onClose={() => setAdding(null)} />}
    </div>
  );
}
