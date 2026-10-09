"use client";

import { useActionState } from "react";
import { btnCls, inputCls } from "@/components/ui";

type State = { message?: string; error?: string };

export function ImportForm({ action }: { action: (prev: State, fd: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <p className="text-xs text-ink-400 dark:text-ink-200">
        Erste Zeile = Spaltennamen: <code>firstName,lastName,email,phone,company,tags</code>. Mehrere Tags mit „|“ trennen.
        Der Import setzt keine E-Mail-Einwilligung.
      </p>
      <input type="file" name="file" accept=".csv,text/csv" className="text-sm" aria-label="CSV-Datei auswählen" />
      <textarea name="csv" rows={4} className={inputCls} placeholder="…oder CSV hier einfügen" />
      <button className={btnCls} disabled={pending}>{pending ? "Importiere…" : "Importieren"}</button>
      {state.message && <p className="text-sm text-green-700">{state.message}</p>}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
