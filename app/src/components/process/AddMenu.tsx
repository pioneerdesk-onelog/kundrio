"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NODE_TYPE_KEYS, NODE_TYPES, OUTPUT_LABELS, type NodeType } from "@/lib/process/definition";
import { NODE_HELP } from "@/lib/process-ui/help";
import { inputCls } from "@/components/ui";

/** Auswahl-Dialog für einen neuen Schritt, gruppiert und durchsuchbar. */
export function AddMenu({ output, onPick, onClose }: { output: string; onPick: (t: NodeType) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const map = new Map<string, NodeType[]>();
    for (const t of NODE_TYPE_KEYS) {
      const s = NODE_TYPES[t];
      if (term && !`${s.label} ${s.group} ${NODE_HELP[t]}`.toLowerCase().includes(term)) continue;
      map.set(s.group, [...(map.get(s.group) ?? []), t]);
    }
    return [...map];
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Schritt hinzufügen"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl dark:bg-ink-900"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="border-b border-ink-100 p-4 dark:border-white/10">
          <h2 className="mb-2 text-lg font-semibold">
            Schritt hinzufügen{output !== "next" ? ` – Zweig „${OUTPUT_LABELS[output] ?? output}“` : ""}
          </h2>
          <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen, z. B. Aufgabe, KI, warten …" className={inputCls} aria-label="Schritte durchsuchen" />
        </div>
        <div className="overflow-y-auto p-4">
          {groups.length === 0 && <p className="text-ink-400">Nichts gefunden.</p>}
          {groups.map(([group, types]) => (
            <section key={group} className="mb-4">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-200">{group}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {types.map((t) => (
                  <li key={t}>
                    <button
                      type="button"
                      onClick={() => onPick(t)}
                      className="w-full rounded-lg border border-ink-100 p-3 text-left hover:border-accent-500 hover:bg-accent-50 focus-visible:border-accent-500 dark:border-white/10 dark:hover:bg-white/5"
                    >
                      <div className="flex items-center gap-2 text-[15px] font-semibold text-ink-900 dark:text-ink-50">
                        {NODE_TYPES[t].label}
                        {NODE_TYPES[t].external && <span className="rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-900">Freigabe nötig</span>}
                      </div>
                      <div className="mt-0.5 text-sm text-ink-600 dark:text-ink-200">{NODE_HELP[t]}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="border-t border-ink-100 p-3 text-right dark:border-white/10">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm hover:bg-sand-100 dark:hover:bg-white/10">
            Abbrechen (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
