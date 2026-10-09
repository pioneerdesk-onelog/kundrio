"use client";

import { createContext, useContext } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Handle, Position, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { Plus, Zap } from "lucide-react";
import { NODE_TYPES, OUTPUT_LABELS, outputsOf, type ProcessNode, type ValidationIssue } from "@/lib/process/definition";
import { NODE_H, NODE_W } from "@/lib/process-ui/graph";

// Gemeinsamer Zustand für Knoten/Kanten (Callbacks aus dem Editor).
export type CanvasCtx = {
  onAdd: (from: string, output: string) => void;
  issuesByNode: Map<string, ValidationIssue[]>;
  changed: Set<string>;
  readOnly: boolean;
};
export const CanvasContext = createContext<CanvasCtx>({ onAdd: () => {}, issuesByNode: new Map(), changed: new Set(), readOnly: false });

export type TriggerData = { title: string; summary: string; filterCount: number; reenroll: boolean; hasGoal: boolean; changed: boolean; issues: number };
export type StepData = { node: ProcessNode; summary: string; freeOutputs: string[] };
export type TriggerRFNode = Node<TriggerData, "trigger">;
export type StepRFNode = Node<StepData, "step">;
export type PlusEdgeData = { from: string; output: string; label?: string };
export type PlusRFEdge = Edge<PlusEdgeData, "plus">;

const GROUP_TONE: Record<string, string> = {
  Daten: "border-t-sky-600",
  Vertrieb: "border-t-emerald-600",
  Service: "border-t-teal-600",
  Kommunikation: "border-t-amber-600",
  Integration: "border-t-orange-700",
  "KI-Erkennung": "border-t-violet-600",
  Logik: "border-t-ink-600",
};

export function TriggerNode({ data, selected }: NodeProps<TriggerRFNode>) {
  return (
    <div
      style={{ width: NODE_W }}
      className={`rounded-xl border-2 bg-white p-3.5 shadow-sm dark:bg-ink-900 ${selected ? "border-accent-500 ring-2 ring-accent-100" : "border-accent-300 dark:border-accent-300/60"}`}
    >
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-100">
        <Zap size={15} aria-hidden /> Auslöser
        {data.changed && <span className="ml-auto rounded bg-amber-100 px-1.5 text-xs font-medium normal-case text-amber-900">geändert</span>}
        {data.issues > 0 && <span className="ml-auto rounded bg-red-100 px-1.5 text-xs font-medium normal-case text-red-800">{data.issues} Fehler</span>}
      </div>
      <div className="text-[15px] font-semibold text-ink-900 dark:text-ink-50">{data.title}</div>
      <div className="mt-0.5 line-clamp-2 text-sm text-ink-600 dark:text-ink-200">{data.summary}</div>
      <div className="mt-1.5 text-xs text-ink-400 dark:text-ink-200">
        {data.filterCount ? `${data.filterCount} Filter` : "ohne Filter"} · {data.reenroll ? "erneut einschreibbar" : "einmal je Datensatz"}
        {data.hasGoal ? " · mit Ziel" : ""}
      </div>
      <Handle type="source" position={Position.Bottom} id="next" className="!h-2 !w-2 !border-0 !bg-accent-500" />
    </div>
  );
}

export function StepNode({ data, selected }: NodeProps<StepRFNode>) {
  const { onAdd, issuesByNode, changed, readOnly } = useContext(CanvasContext);
  const spec = NODE_TYPES[data.node.type];
  const issues = issuesByNode.get(data.node.id) ?? [];
  const errors = issues.filter((i) => i.level === "error").length;
  const outs = [...outputsOf(data.node.type), "error"];
  const tone = GROUP_TONE[spec.group] ?? "border-t-ink-400";
  return (
    <div
      style={{ width: NODE_W, minHeight: NODE_H - 20 }}
      className={`rounded-xl border border-t-4 bg-white p-3 shadow-sm dark:bg-ink-900 ${tone} ${
        errors ? "border-red-400 dark:border-red-400" : selected ? "border-accent-500 ring-2 ring-accent-100" : "border-ink-200 dark:border-white/15"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-ink-400" />
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-400 dark:text-ink-200">
        <span>{spec.group}</span>
        {spec.external && <span className="rounded bg-amber-100 px-1.5 text-amber-900">Außenwirkung</span>}
        {changed.has(data.node.id) && <span className="rounded bg-amber-100 px-1.5 text-amber-900">geändert</span>}
        {errors > 0 && <span className="ml-auto rounded bg-red-100 px-1.5 text-red-800">{errors} Fehler</span>}
      </div>
      <div className="mt-0.5 text-[15px] font-semibold text-ink-900 dark:text-ink-50">{data.node.label || spec.label}</div>
      {data.summary && <div className="mt-0.5 line-clamp-2 text-sm text-ink-600 dark:text-ink-200">{data.summary}</div>}
      {!readOnly && data.freeOutputs.length > 0 && (
        <div className="nodrag mt-2 flex flex-wrap gap-1.5">
          {data.freeOutputs
            .filter((o) => o !== "error")
            .map((o) => (
              <button
                key={o}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(data.node.id, o);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-ink-200 px-2 py-0.5 text-xs text-ink-600 hover:border-accent-500 hover:text-accent-600 dark:border-white/20 dark:text-ink-100"
                aria-label={`Schritt anhängen (${OUTPUT_LABELS[o] ?? o})`}
              >
                <Plus size={12} aria-hidden /> {o === "next" ? "Schritt" : OUTPUT_LABELS[o] ?? o}
              </button>
            ))}
        </div>
      )}
      {outs.map((o, i) => (
        <Handle
          key={o}
          type="source"
          position={Position.Bottom}
          id={o}
          style={{ left: o === "error" ? "94%" : `${((i + 1) / (outs.length)) * 100 - 100 / outs.length / 2}%` }}
          className={`!h-2 !w-2 !border-0 ${o === "error" ? "!bg-red-400" : "!bg-ink-400"}`}
        />
      ))}
    </div>
  );
}

export function PlusEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<PlusRFEdge>) {
  const { onAdd, readOnly } = useContext(CanvasContext);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 });
  const isError = data?.output === "error";
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ strokeWidth: 1.6, stroke: isError ? "#f87171" : "#7a8591", strokeDasharray: isError ? "5 4" : undefined }} />
      <EdgeLabelRenderer>
        <div className="nodrag nopan pointer-events-auto absolute flex items-center gap-1" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          {data?.label && <span className="rounded bg-sand-100 px-1.5 py-0.5 text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-100">{data.label}</span>}
          {!readOnly && data && (
            <button
              type="button"
              onClick={() => onAdd(data.from, data.output)}
              className="grid h-6 w-6 place-items-center rounded-full border border-ink-200 bg-white text-ink-600 shadow-sm hover:border-accent-500 hover:text-accent-600 dark:border-white/20 dark:bg-ink-900 dark:text-ink-100"
              aria-label="Schritt hier einfügen"
              title="Schritt hier einfügen"
            >
              <Plus size={14} aria-hidden />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const nodeTypes = { trigger: TriggerNode, step: StepNode };
export const edgeTypes = { plus: PlusEdge };
