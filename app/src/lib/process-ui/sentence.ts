// „In Worten“: beschreibt einen Prozess als verständliche Sätze (Auslöser → Schritte mit Verzweigungen).
import { NODE_TYPES, OBJECT_LABELS, TRIGGER_TYPES, type ObjectType, type ProcessDefinition } from "@/lib/process/definition";
import { groupText, nodeSummary, triggerSummary, type Lookup } from "./summary";

export type SentenceLine = { depth: number; text: string; nodeId?: string };

const BRANCH_TEXT: Record<string, string> = { yes: "Wenn ja", no: "Wenn nein", met: "Sobald erfüllt", timeout: "Wenn die Frist abläuft", error: "Falls dieser Schritt scheitert" };

export function describeProcess(def: ProcessDefinition, objectType: ObjectType, l: Lookup): SentenceLine[] {
  const lines: SentenceLine[] = [];
  const t = TRIGGER_TYPES[def.trigger.type];
  const ts = triggerSummary(def, l);
  const filter = def.enrollment.filters.conditions.length ? ` und ${groupText(def.enrollment.filters, l)}` : "";
  lines.push({ depth: 0, text: `Wenn „${t.label}“${ts.summary && !ts.summary.startsWith("Nur wenn") && ts.summary !== "für alle passenden Datensätze" ? ` (${ts.summary.split(" – ")[0]})` : ""}${filter} – für ${OBJECT_LABELS[objectType]}:` });
  if (def.enrollment.reenroll) lines.push({ depth: 1, text: "Ein Datensatz darf nach Ende seines Laufs erneut starten." });
  if (def.goal?.conditions.length) lines.push({ depth: 1, text: `Ziel: Sobald ${groupText(def.goal, l)}, endet der Lauf vorzeitig.` });

  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const numbers = new Map<string, number>();
  let counter = 0;

  const walk = (id: string | undefined, depth: number, guard: Set<string>) => {
    while (id) {
      const n = byId.get(id);
      if (!n) return;
      if (numbers.has(id)) {
        lines.push({ depth, text: `→ weiter wie bei Schritt ${numbers.get(id)}.`, nodeId: id });
        return;
      }
      if (guard.has(id)) return;
      guard.add(id);
      const no = ++counter;
      numbers.set(id, no);
      const name = n.label || NODE_TYPES[n.type].label;
      const sum = nodeSummary(n, l);
      if (n.type === "logic.end") {
        lines.push({ depth, text: `${no}. Ende.`, nodeId: id });
        return;
      }
      if (n.type === "logic.if") {
        lines.push({ depth, text: `${no}. Prüfen: ${sum}`, nodeId: id });
      } else if (n.type === "logic.wait_until") {
        lines.push({ depth, text: `${no}. Warten, bis ${sum}`, nodeId: id });
      } else {
        lines.push({ depth, text: `${no}. ${name}${sum ? `: ${sum}` : ""}${NODE_TYPES[n.type].external ? " (Außenwirkung – nach Freigabe)" : ""}`, nodeId: id });
      }
      const outs = def.edges.filter((e) => e.from === id);
      const err = outs.find((e) => e.output === "error");
      const branches = outs.filter((e) => e.output !== "next" && e.output !== "error");
      if (err) {
        lines.push({ depth: depth + 1, text: `${BRANCH_TEXT.error}:` });
        walk(err.to, depth + 2, new Set(guard));
      }
      if (branches.length) {
        for (const b of branches) {
          lines.push({ depth: depth + 1, text: `${BRANCH_TEXT[b.output] ?? b.output}:` });
          walk(b.to, depth + 2, new Set(guard));
        }
        return;
      }
      id = outs.find((e) => e.output === "next")?.to;
    }
  };
  walk(def.start, 1, new Set());
  const unreachable = def.nodes.filter((n) => !numbers.has(n.id));
  if (unreachable.length) lines.push({ depth: 0, text: `Nicht verbunden (werden nie ausgeführt): ${unreachable.map((n) => n.label || NODE_TYPES[n.type].label).join(", ")}.` });
  return lines;
}
