// Mini-Fluss: Auslöser → Schritte als Symbolkette (für Landkarte und Detailseiten). Server- und Client-tauglich.
import { Bot, Briefcase, Clock, Database, Flag, GitBranch, LifeBuoy, Mail, Plug, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { NODE_TYPES, TRIGGER_TYPES, type ProcessDefinition, type ProcessNode } from "@/lib/process/definition";

const GROUP_ICON: Record<string, ReactNode> = {
  Daten: <Database size={14} aria-hidden />,
  Vertrieb: <Briefcase size={14} aria-hidden />,
  Service: <LifeBuoy size={14} aria-hidden />,
  Kommunikation: <Mail size={14} aria-hidden />,
  Integration: <Plug size={14} aria-hidden />,
  "KI-Erkennung": <Bot size={14} aria-hidden />,
};

function icon(n: ProcessNode) {
  if (n.type === "logic.if") return <GitBranch size={14} aria-hidden />;
  if (n.type === "logic.wait" || n.type === "logic.wait_until") return <Clock size={14} aria-hidden />;
  if (n.type === "logic.end") return <Flag size={14} aria-hidden />;
  return GROUP_ICON[NODE_TYPES[n.type].group] ?? <Zap size={14} aria-hidden />;
}

/** Hauptpfad (start → next/ja/erfüllt), höchstens `max` Schritte; Verzweigungen werden markiert. */
export function mainPath(def: ProcessDefinition, max = 12): { node: ProcessNode; branches: number }[] {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const out: { node: ProcessNode; branches: number }[] = [];
  const seen = new Set<string>();
  let id: string | undefined = def.start;
  while (id && !seen.has(id) && out.length < max) {
    seen.add(id);
    const n = byId.get(id);
    if (!n) break;
    const outs = def.edges.filter((e) => e.from === id);
    out.push({ node: n, branches: outs.filter((e) => e.output !== "next").length });
    id = (outs.find((e) => e.output === "next") ?? outs.find((e) => e.output === "yes" || e.output === "met"))?.to;
  }
  return out;
}

export function MiniFlow({ def }: { def: ProcessDefinition }) {
  const path = mainPath(def);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-ink-600 dark:text-ink-200" aria-label="Ablauf in Kurzform">
      <li title={`Auslöser: ${TRIGGER_TYPES[def.trigger.type].label}`} className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700 dark:bg-accent-500/20 dark:text-accent-100">
        <Zap size={12} aria-hidden /> {TRIGGER_TYPES[def.trigger.type].label}
      </li>
      {path.map(({ node, branches }) => (
        <li key={node.id} className="inline-flex items-center gap-1">
          <span aria-hidden className="text-ink-200">▸</span>
          <span
            title={`${node.label || NODE_TYPES[node.type].label}${branches ? ` (+${branches} Zweig${branches > 1 ? "e" : ""})` : ""}`}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border ${NODE_TYPES[node.type].external ? "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" : "border-ink-100 bg-white dark:border-white/10 dark:bg-ink-900"}`}
          >
            {icon(node)}
            <span className="sr-only">{node.label || NODE_TYPES[node.type].label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
