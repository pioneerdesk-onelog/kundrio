"use client";

import { useActionState } from "react";
import { btnCls, inputCls, labelCls } from "@/components/ui";
import type { HubspotState } from "@/app/(admin)/sa/[slug]/listen/wechsel/hubspot-actions";

export function HubspotImportForm({ action, disabled }: { action: (prev: HubspotState, fd: FormData) => Promise<HubspotState>; disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className={labelCls}>HubSpot Service Key bzw. Private-App-Token</span>
        <input name="token" type="password" autoComplete="off" required className={`${inputCls} font-mono`} disabled={disabled} />
      </label>
      <p className="text-sm text-ink-600 dark:text-ink-200">
        Benötigte Lese-Bereiche: Kontakte, Unternehmen, Deals, Tickets, Zuständige (owners), Schemas/Eigenschaften. Neue „Legacy Private Apps“
        lassen sich in HubSpot ab 26.10.2026 nicht mehr anlegen – dann einen Service Key verwenden. Der Schlüssel wird nicht gespeichert:
        Er liegt nur verschlüsselt im laufenden Import-Job und wird nach jedem Schritt entfernt.
      </p>
      <label className="flex items-start gap-2 text-[15px]">
        <input type="checkbox" name="confirm" className="mt-1" disabled={disabled} />
        <span>Ich bestätige, dass diese Daten in dieses CRM übernommen werden dürfen (gleicher Verantwortlicher, gleicher Zweck).</span>
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{state.ok}</p>}
      <button className={btnCls} disabled={pending || disabled}>{pending ? "Prüfe Zugang …" : "Import aus HubSpot starten"}</button>
    </form>
  );
}
