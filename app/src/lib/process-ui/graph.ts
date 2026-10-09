// Reine Graph-Hilfen für den Flow-Editor (Client und Tests). Keine Seiteneffekte:
// jede Funktion liefert eine NEUE Definition zurück.
import { NODE_TYPES, outputsOf, type NodeType, type ProcessDefinition, type ProcessEdge, type ProcessNode } from "@/lib/process/definition";
import { defaultConfigFor } from "./form";

/** Pseudo-ID der Auslöser-Karte (kein echter Knoten der Definition). */
export const TRIGGER_ID = "__trigger";

export const NODE_W = 300;
export const NODE_H = 118;
const GAP_X = 40;
const GAP_Y = 70;

/** Eindeutige, lesbare Knoten-ID, z. B. "set_property_2". */
export function newNodeId(def: ProcessDefinition, type: NodeType): string {
  const base = type.split(".")[1].replace(/[^a-z0-9_]/gi, "_").slice(0, 30);
  const ids = new Set(def.nodes.map((n) => n.id));
  for (let i = 1; ; i++) {
    const candidate = `${base}_${i}`;
    if (!ids.has(candidate)) return candidate;
  }
}

/** Primärer Ausgang eines Knotens (dort hängt der Rest des Flusses beim Einfügen/Löschen). */
export function primaryOutput(type: NodeType): string | null {
  const outs = outputsOf(type);
  return outs[0] ?? null;
}

/** Ziel der Kante (from, output) oder null. */
export function targetOf(def: ProcessDefinition, from: string, output: string): string | null {
  if (from === TRIGGER_ID) return def.start;
  return def.edges.find((e) => e.from === from && e.output === output)?.to ?? null;
}

export type InsertAt = { from: string; output: string };

/**
 * Fügt einen neuen Knoten an der Stelle (from, output) ein.
 * Der bisherige Nachfolger wird an den primären Ausgang des neuen Knotens gehängt
 * (bei „Ende“ entfällt er; der dahinterliegende Teil wird entfernt, wenn er sonst unerreichbar wäre).
 */
export function insertNode(def: ProcessDefinition, at: InsertAt, type: NodeType, opts: { id?: string; config?: Record<string, unknown> } = {}): { def: ProcessDefinition; id: string } {
  const id = opts.id ?? newNodeId(def, type);
  const node: ProcessNode = { id, type, config: opts.config ?? defaultConfigFor(type), position: { x: 0, y: 0 } };
  const oldTarget = targetOf(def, at.from, at.output);
  const out = primaryOutput(type);
  let edges = def.edges.filter((e) => !(at.from !== TRIGGER_ID && e.from === at.from && e.output === at.output));
  let start = def.start;
  if (at.from === TRIGGER_ID) start = id;
  else edges = [...edges, { from: at.from, to: id, output: at.output }];
  if (oldTarget && out) edges = [...edges, { from: id, to: oldTarget, output: out }];
  let next: ProcessDefinition = { ...def, start, nodes: [...def.nodes, node], edges };
  if (oldTarget && !out) next = dropUnreachable(next);
  return { def: autoLayout(next), id };
}

/**
 * Löscht einen Knoten. Eingehende Kanten zeigen danach auf den Nachfolger am primären Ausgang
 * (bei Wenn/Dann: „ja“-Zweig). Andere Zweige des gelöschten Knotens werden entfernt, wenn sie
 * dadurch unerreichbar werden. Der letzte verbleibende Knoten wird zu „Ende“.
 */
export function deleteNode(def: ProcessDefinition, id: string): ProcessDefinition {
  const node = def.nodes.find((n) => n.id === id);
  if (!node) return def;
  const out = primaryOutput(node.type);
  const successor = out ? targetOf(def, id, out) : null;
  const incoming = def.edges.filter((e) => e.to === id);
  let edges = def.edges.filter((e) => e.from !== id && e.to !== id);
  if (successor) edges = [...edges, ...incoming.map((e) => ({ ...e, to: successor }))];
  let start = def.start;
  if (def.start === id) start = successor ?? "";
  let nodes = def.nodes.filter((n) => n.id !== id);
  if (nodes.length === 0 || !start) {
    const endId = nodes.some((n) => n.id === "ende") ? newNodeId({ ...def, nodes }, "logic.end") : "ende";
    nodes = [...nodes, { id: endId, type: "logic.end", config: {}, position: { x: 0, y: 0 } }];
    if (!start) start = endId;
    if (successor === null) edges = [...edges, ...incoming.map((e) => ({ ...e, to: endId }))];
  }
  return autoLayout(dropUnreachable({ ...def, start, nodes, edges: dedupeEdges(edges) }));
}

/** Verbindet einen freien Ausgang mit einem vorhandenen Knoten (z. B. Zweige wieder zusammenführen). */
export function connect(def: ProcessDefinition, from: string, output: string, to: string): ProcessDefinition {
  const edges = def.edges.filter((e) => !(e.from === from && e.output === output));
  return { ...def, edges: [...edges, { from, to, output }] };
}

/** Entfernt die Verbindung (from, output). */
export function disconnect(def: ProcessDefinition, from: string, output: string): ProcessDefinition {
  return { ...def, edges: def.edges.filter((e) => !(e.from === from && e.output === output)) };
}

function dedupeEdges(edges: ProcessEdge[]): ProcessEdge[] {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const k = `${e.from}|${e.output}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Ab dem Start erreichbare Knoten-IDs. */
export function reachable(def: ProcessDefinition): Set<string> {
  const seen = new Set<string>();
  const stack = def.start ? [def.start] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of def.edges) if (e.from === id) stack.push(e.to);
  }
  return seen;
}

/** Entfernt Knoten (und Kanten), die vom Start aus nicht mehr erreichbar sind. */
export function dropUnreachable(def: ProcessDefinition): ProcessDefinition {
  const keep = reachable(def);
  if (keep.size === def.nodes.length) return def;
  return { ...def, nodes: def.nodes.filter((n) => keep.has(n.id)), edges: def.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}

/** Reihenfolge der Ausgänge für das Layout (ja links, nein rechts, Fehler ganz rechts). */
function orderedOutputs(type: NodeType): string[] {
  return [...outputsOf(type), "error"];
}

/**
 * Vertikales Baum-Layout (HubSpot-ähnlich): Ebenen von oben nach unten, Zweige nebeneinander.
 * Knoten mit mehreren Vorgängern (zusammengeführte Zweige) stehen unter ihrem ersten Vorgänger,
 * auf der tiefsten Ebene ihrer Vorgänger.
 */
export function autoLayout(def: ProcessDefinition): ProcessDefinition {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  if (!byId.has(def.start)) return def;

  // Ebene = längster Weg vom Start (DAG); Zyklen werden durch Besuchsmarke abgefangen
  const depth = new Map<string, number>();
  const order: string[] = [];
  const visiting = new Set<string>();
  const dfs = (id: string, d: number) => {
    if (visiting.has(id)) return;
    if ((depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    visiting.add(id);
    if (!order.includes(id)) order.push(id);
    const n = byId.get(id);
    if (n) for (const o of orderedOutputs(n.type)) for (const e of def.edges) if (e.from === id && e.output === o && byId.has(e.to)) dfs(e.to, d + 1);
    visiting.delete(id);
  };
  dfs(def.start, 0);

  // Baum über den ersten Vorgänger (in Ausgabe-Reihenfolge) bilden
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  const assign = (id: string) => {
    const n = byId.get(id);
    if (!n) return;
    for (const o of orderedOutputs(n.type)) {
      for (const e of def.edges) {
        if (e.from !== id || e.output !== o || !byId.has(e.to) || e.to === def.start) continue;
        if (!parent.has(e.to) && (depth.get(e.to) ?? 0) > (depth.get(id) ?? 0)) {
          parent.set(e.to, id);
          children.set(id, [...(children.get(id) ?? []), e.to]);
          assign(e.to);
        }
      }
    }
  };
  assign(def.start);

  const width = new Map<string, number>();
  const measure = (id: string): number => {
    const kids = children.get(id) ?? [];
    const w = kids.length === 0 ? 1 : kids.reduce((a, k) => a + measure(k), 0);
    width.set(id, w);
    return w;
  };
  measure(def.start);

  const pos = new Map<string, { x: number; y: number }>();
  const place = (id: string, left: number) => {
    const w = width.get(id) ?? 1;
    const unit = NODE_W + GAP_X;
    const x = left + (w * unit - unit) / 2;
    pos.set(id, { x, y: (depth.get(id) ?? 0) * (NODE_H + GAP_Y) + NODE_H + GAP_Y });
    let cursor = left;
    for (const k of children.get(id) ?? []) {
      place(k, cursor);
      cursor += (width.get(k) ?? 1) * unit;
    }
  };
  place(def.start, 0);

  // Nicht erreichbare Knoten rechts daneben stapeln, damit sie sichtbar bleiben
  const maxX = Math.max(0, ...[...pos.values()].map((p) => p.x));
  let stray = 0;
  const nodes = def.nodes.map((n) => {
    const p = pos.get(n.id) ?? { x: maxX + (NODE_W + GAP_X) * 1.5, y: (stray++ + 1) * (NODE_H + GAP_Y) };
    return { ...n, position: p };
  });
  return { ...def, nodes };
}

/** Position der Auslöser-Karte über dem Startknoten. */
export function triggerPosition(def: ProcessDefinition): { x: number; y: number } {
  const start = def.nodes.find((n) => n.id === def.start);
  return { x: start?.position.x ?? 0, y: (start?.position.y ?? NODE_H + GAP_Y) - (NODE_H + GAP_Y) };
}

/** Knoten, die sich zwischen zwei Definitionen unterscheiden (neu oder geändert). */
export function changedNodeIds(draft: ProcessDefinition, active: ProcessDefinition | null): Set<string> {
  const changed = new Set<string>();
  if (!active) return changed;
  const sig = (d: ProcessDefinition, n: ProcessNode) =>
    JSON.stringify([
      n.type,
      n.label ?? "",
      n.config,
      d.edges
        .filter((e) => e.from === n.id)
        .map((e) => `${e.output}>${e.to}`)
        .sort(),
    ]);
  const before = new Map(active.nodes.map((n) => [n.id, sig(active, n)]));
  for (const n of draft.nodes) if (before.get(n.id) !== sig(draft, n)) changed.add(n.id);
  return changed;
}

/** true, wenn sich Auslöser, Filter oder Ziel unterscheiden. */
export function triggerChanged(draft: ProcessDefinition, active: ProcessDefinition | null): boolean {
  if (!active) return false;
  return JSON.stringify([draft.trigger, draft.enrollment, draft.goal ?? null]) !== JSON.stringify([active.trigger, active.enrollment, active.goal ?? null]);
}

/** Ist der Knotentyp mit Außenwirkung? */
export function isExternal(type: NodeType): boolean {
  return NODE_TYPES[type].external;
}
