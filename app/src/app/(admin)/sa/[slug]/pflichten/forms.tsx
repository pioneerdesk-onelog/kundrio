"use client";

import { useActionState } from "react";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";
import type { ItemState } from "./actions";

const STATUS: [string, string][] = [["OPEN", "Offen"], ["IN_PROGRESS", "In Arbeit"], ["DONE", "Erledigt"], ["N_A", "Nicht relevant"]];

export function RunChecksButton({ action }: { action: (s: ItemState) => Promise<ItemState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex items-center gap-3">
      <button className={btnGhostCls} disabled={pending}>{pending ? "Prüfe DNS & Daten …" : "Jetzt prüfen"}</button>
      <span role="status" aria-live="polite" className={state.error ? "text-sm text-red-700" : "text-sm text-emerald-700 dark:text-emerald-300"}>{state.error ?? state.ok}</span>
    </form>
  );
}

export function ItemForm({ id, action, status, evidence, dueAt, suggestion }: {
  id: string;
  action: (s: ItemState, f: FormData) => Promise<ItemState>;
  status: string;
  evidence: string | null;
  dueAt: string;
  suggestion?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-[160px_160px_1fr_auto] sm:items-end">
      <div>
        <label htmlFor={`st-${id}`} className="mb-1 block text-sm text-ink-600 dark:text-ink-200">Status</label>
        <select id={`st-${id}`} name="status" defaultValue={status} className={inputCls}>
          {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {suggestion && <p className="mt-1 text-xs text-ink-400">Vorschlag: {suggestion}</p>}
      </div>
      <div>
        <label htmlFor={`due-${id}`} className="mb-1 block text-sm text-ink-600 dark:text-ink-200">Fällig</label>
        <input id={`due-${id}`} name="dueAt" type="date" defaultValue={dueAt} className={inputCls} />
      </div>
      <div>
        <label htmlFor={`ev-${id}`} className="mb-1 block text-sm text-ink-600 dark:text-ink-200">Nachweis</label>
        <input id={`ev-${id}`} name="evidence" defaultValue={evidence ?? ""} maxLength={2000} placeholder="z. B. Link, Dokument, Datum" className={inputCls} />
      </div>
      <div className="flex items-center gap-2">
        <button className={btnCls} disabled={pending}>Speichern</button>
      </div>
      {(state.ok || state.error) && (
        <p role="status" className={`sm:col-span-4 text-sm ${state.error ? "text-red-700" : "text-emerald-700 dark:text-emerald-300"}`}>{state.error ?? state.ok}</p>
      )}
    </form>
  );
}
