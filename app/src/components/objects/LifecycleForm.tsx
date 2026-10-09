"use client";

import { useRef, useState, useTransition } from "react";
import { btnGhostCls, inputCls, labelCls } from "@/components/ui";

type Stage = { key: string; label: string; position: number };

/** Lifecycle-Phase ändern: vorwärts direkt, Rückschritt nur nach Rückfrage (HubSpot-Verhalten). */
export function LifecycleForm({ stages, current, action }: { stages: Stage[]; current: string; action: (fd: FormData) => Promise<void> }) {
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const confirmRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const from = stages.find((s) => s.key === current);
    const to = stages.find((s) => s.key === value);
    const backward = !!from && !!to && from.key !== "other" && to.key !== "other" && to.position < from.position;
    if (backward && !window.confirm(`Phase zurück von „${from.label}“ auf „${to.label}“ setzen? Prozesse können dadurch erneut auslösen.`)) return;
    if (confirmRef.current) confirmRef.current.value = backward ? "on" : "";
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      try {
        await action(fd);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block">
        <span className={labelCls}>Lifecycle-Phase</span>
        <select name="lifecycleStage" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls}>
          {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <input ref={confirmRef} type="hidden" name="confirmBack" defaultValue="" />
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <button className={btnGhostCls} disabled={pending || value === current}>{pending ? "Speichere …" : "Phase setzen"}</button>
    </form>
  );
}
