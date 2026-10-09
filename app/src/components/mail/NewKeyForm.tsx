"use client";

import { SCOPE_LABEL } from "@/lib/apikey-labels";
import { useActionState } from "react";
import { btnCls, inputCls, labelCls } from "@/components/ui";
import { CopyButton } from "./CopyButton";

type KeyState = { error?: string; plain?: string; name?: string };


export function NewKeyForm({ action, scopes }: { action: (prev: KeyState, fd: FormData) => Promise<KeyState>; scopes: readonly string[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <div className="space-y-4">
      {state.plain && (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          <p className="mb-2 font-semibold">Schlüssel „{state.name}“ angelegt. Er wird nur jetzt angezeigt – bitte sicher speichern.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 font-mono text-sm text-ink-900 dark:bg-ink-900 dark:text-ink-50">{state.plain}</code>
            <CopyButton text={state.plain} />
          </div>
        </div>
      )}
      <form action={formAction} className="space-y-3">
        <label className="block">
          <span className={labelCls}>Name</span>
          <input name="name" required maxLength={80} placeholder="z. B. Kompetenzanker Produktion" className={inputCls} />
        </label>
        <fieldset>
          <legend className={labelCls}>Berechtigungen</legend>
          <div className="space-y-1">
            {scopes.map((s) => (
              <label key={s} className="flex items-center gap-2 text-[15px]">
                <input type="checkbox" name="scopes" value={s} defaultChecked={s === "mail:send" || s === "templates:read"} />
                <code className="text-sm">{s}</code> <span className="text-ink-600 dark:text-ink-200">– {(SCOPE_LABEL as Record<string, string>)[s] ?? s}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
        <button className={btnCls} disabled={pending}>{pending ? "Lege an …" : "Schlüssel anlegen"}</button>
      </form>
    </div>
  );
}
