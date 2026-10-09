"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { OBJECT_LABELS, type ObjectType } from "@/lib/process/definition";
import { Badge, btnCls, inputCls } from "@/components/ui";
import { RUN_STATUS, RunTimeline } from "./RunTimeline";
import type { ActionResult, RunView } from "./types";

type Search = (objectType: string, q: string) => Promise<ActionResult<{ id: string; label: string }[]>>;
type Start = (objectId: string) => Promise<ActionResult<{ runId: string }>>;
type Poll = (runId: string) => Promise<ActionResult<RunView>>;

const ACTIVE = new Set(["running", "waiting"]);

/** Testlauf: Datensatz wählen, im Testmodus durchlaufen lassen, Schritte live anzeigen. */
export function TestRun({ objectType, search, start, poll, beforeStart, labels }: { objectType: ObjectType; search: Search; start: Start; poll: Poll; beforeStart: () => Promise<boolean>; labels: Record<string, string> }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; label: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Suche leicht verzögert
  useEffect(() => {
    const h = setTimeout(async () => {
      const r = await search(objectType, q);
      if (r.ok) setHits(r.data);
    }, 250);
    return () => clearTimeout(h);
  }, [q, objectType, search]);

  const follow = (runId: string, n = 0) => {
    timer.current = setTimeout(async () => {
      const r = await poll(runId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setRun(r.data);
      // Höchstens ~1 Minute verfolgen; wartende Läufe bleiben stehen (Wartezeiten)
      if (r.data.status === "running" && n < 40) follow(runId, n + 1);
    }, 1500);
  };

  const go = () =>
    startTransition(async () => {
      if (!picked) return;
      setError(null);
      setRun(null);
      if (!(await beforeStart())) return;
      const r = await start(picked.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      follow(r.data.runId);
    });

  return (
    <div className="space-y-3">
      <p className="text-[15px] text-ink-600 dark:text-ink-200">Testlauf mit einem echten Datensatz – ohne Außenwirkung (keine E-Mails, keine Webhooks). Der aktuelle Entwurf wird vorher gespeichert.</p>
      <label className="block">
        <span className="sr-only">{OBJECT_LABELS[objectType]} suchen</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${OBJECT_LABELS[objectType]} suchen …`} className={`${inputCls} !py-1.5`} />
      </label>
      <ul className="max-h-40 overflow-y-auto rounded-md border border-ink-100 dark:border-white/10" role="listbox" aria-label="Treffer">
        {hits.length === 0 && <li className="px-3 py-2 text-sm text-ink-400">Keine Treffer.</li>}
        {hits.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              role="option"
              aria-selected={picked?.id === h.id}
              onClick={() => setPicked(h)}
              className={`w-full px-3 py-1.5 text-left text-[15px] hover:bg-sand-100 dark:hover:bg-white/10 ${picked?.id === h.id ? "bg-accent-50 font-medium dark:bg-accent-500/20" : ""}`}
            >
              {h.label}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={btnCls} disabled={!picked || pending} onClick={go}>
        {pending ? "Startet …" : picked ? `Testlauf mit „${picked.label.slice(0, 30)}“` : "Datensatz wählen"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {run && (
        <div className="space-y-2" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-medium">Ergebnis</span>
            <Badge tone={RUN_STATUS[run.status]?.tone ?? "neutral"}>{RUN_STATUS[run.status]?.label ?? run.status}</Badge>
            {ACTIVE.has(run.status) && run.status === "running" && <span className="text-sm text-ink-400">aktualisiert sich …</span>}
          </div>
          {run.error && <p className="text-sm text-red-700 dark:text-red-300">{run.error}</p>}
          <RunTimeline steps={run.steps} labels={labels} />
        </div>
      )}
    </div>
  );
}
