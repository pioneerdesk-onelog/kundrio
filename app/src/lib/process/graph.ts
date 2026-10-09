import type { ProcessDefinition, ProcessNode } from "./definition";

// Reine Graph-Hilfen für den Ausführer.

export function findNode(def: ProcessDefinition, id: string | null | undefined): ProcessNode | undefined {
  return id ? def.nodes.find((n) => n.id === id) : undefined;
}

/** Nächster Knoten über den gegebenen Ausgang; null = Ende des Ablaufs. */
export function nextNodeId(def: ProcessDefinition, fromId: string, output: string): string | null {
  return def.edges.find((e) => e.from === fromId && e.output === output)?.to ?? null;
}

export function hasErrorEdge(def: ProcessDefinition, fromId: string): boolean {
  return def.edges.some((e) => e.from === fromId && e.output === "error");
}
