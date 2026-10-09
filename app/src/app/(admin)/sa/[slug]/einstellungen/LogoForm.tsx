"use client";

import { useActionState } from "react";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import type { SettingsState } from "./actions";

export function LogoForm({ action, remove, logoSvg, canEdit }: {
  action: (s: SettingsState, f: FormData) => Promise<SettingsState>;
  remove: () => Promise<void>;
  logoSvg: string | null;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <div className="space-y-4">
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-ink-200 bg-white p-3 dark:border-white/15 dark:bg-ink-900">
        {logoSvg ? (
          // Bereinigtes SVG als Bild-Datenquelle: Skripte wären selbst dann wirkungslos
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="Aktuelles Logo" className="max-h-full max-w-full" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg)}`} />
        ) : (
          <span className="text-ink-400">Noch kein Logo</span>
        )}
      </div>
      {canEdit && (
        <form action={formAction} className="space-y-3">
          <div>
            <label htmlFor="logo-file" className={labelCls}>SVG-Datei</label>
            <input id="logo-file" name="file" type="file" accept=".svg,image/svg+xml" className="block text-[15px]" />
          </div>
          <div>
            <label htmlFor="logo-svg" className={labelCls}>… oder SVG-Code einfügen</label>
            <textarea id="logo-svg" name="svg" rows={3} className={`${inputCls} font-mono text-xs`} placeholder="<svg …>…</svg>" />
          </div>
          <p className="text-sm text-ink-400 dark:text-ink-200">Skripte, Event-Handler, eingebettete Inhalte und externe Verweise werden entfernt.</p>
          <div className="flex gap-2">
            <button className={btnCls} disabled={pending}>{pending ? "Prüfen …" : "Logo speichern"}</button>
            {logoSvg && <button formAction={remove} className={btnGhostCls}>Logo entfernen</button>}
          </div>
          <p role="status" aria-live="polite" className={state.error ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}>{state.error ?? state.ok}</p>
        </form>
      )}
    </div>
  );
}
