"use client";

import { useActionState } from "react";
import { btnCls, inputCls, labelCls } from "@/components/ui";
import type { BrevoState } from "@/app/(admin)/sa/[slug]/listen/actions";

export function BrevoImportForm({ action, disabled }: { action: (prev: BrevoState, fd: FormData) => Promise<BrevoState>; disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className={labelCls}>Brevo-API-Schlüssel (v3-REST, beginnt mit „xkeysib-“)</span>
        <input name="apiKey" type="password" autoComplete="off" required className={`${inputCls} font-mono`} disabled={disabled} />
      </label>
      <p className="text-sm text-ink-600 dark:text-ink-200">
        Der Schlüssel wird nicht gespeichert: Er liegt nur verschlüsselt im laufenden Import-Job und wird nach jedem Schritt entfernt.
        Tipp: in Brevo einen eigenen Schlüssel nur für den Umzug anlegen und danach löschen.
      </p>
      <label className="flex items-start gap-2 text-[15px]">
        <input type="checkbox" name="confirm" className="mt-1" disabled={disabled} />
        <span>Ich bestätige, dass diese Kontakte in dieses CRM übernommen werden dürfen (gleicher Verantwortlicher, gleicher Zweck).</span>
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{state.ok}</p>}
      <button className={btnCls} disabled={pending || disabled}>{pending ? "Prüfe Schlüssel …" : "Import aus Brevo starten"}</button>
    </form>
  );
}
