"use client";

import { useActionState } from "react";
import { Badge, inputCls, labelCls } from "@/components/ui";
import { StateForm, Submit, type FormState } from "@/components/users/StateForm";
import type { PreviewState } from "./actions";

type Field = { key: string; label: string; secret: boolean; help?: string };

const ACTION_LABEL: Record<string, { label: string; tone: "ok" | "accent" | "warn" | "bad" | "neutral" }> = {
  keep: { label: "bleibt", tone: "ok" },
  create: { label: "neu", tone: "accent" },
  update: { label: "ändern", tone: "warn" },
  conflict: { label: "Konflikt", tone: "bad" },
};

// API-Einrichtung in zwei Schritten: Vorschau (lesend) → Bestätigung (schreiben).
export function ApiSetup({
  provider,
  fields,
  help,
  preview,
  apply,
  hasStored,
}: {
  provider: string;
  fields: Field[];
  help?: string;
  preview: (prev: PreviewState, fd: FormData) => Promise<PreviewState>;
  apply: (prev: FormState, fd: FormData) => Promise<FormState>;
  hasStored: boolean;
}) {
  const [state, action, pending] = useActionState(preview, {});
  return (
    <div className="space-y-4">
      {help && <p className="text-sm text-ink-600 dark:text-ink-200">{help}</p>}
      <form action={action} className="grid gap-3 md:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className={labelCls}>{f.label}</span>
            <input name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" required className={inputCls} />
            {f.help && <span className="mt-1 block text-xs text-ink-400">{f.help}</span>}
          </label>
        ))}
        <div className="md:col-span-2">
          <button className="rounded-md border border-ink-200 px-3.5 py-2 text-sm font-medium hover:bg-sand-100 dark:border-white/15 dark:hover:bg-white/10" disabled={pending}>
            {pending ? "Verbinde …" : `Mit ${provider} verbinden & Änderungen anzeigen`}
          </button>
          <p className="mt-1 text-xs text-ink-400">Es wird noch nichts geändert. Zugangsdaten werden verschlüsselt und nur bis zur Bestätigung gespeichert.</p>
        </div>
      </form>
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{state.ok}</p>}
      {state.steps && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Geplante DNS-Änderungen</caption>
              <thead className="text-left text-ink-400">
                <tr><th className="py-1 pr-3">Aktion</th><th className="pr-3">Typ</th><th className="pr-3">Name</th><th className="pr-3">Neuer Wert</th><th className="pr-3">Bisher</th><th>Hinweis</th></tr>
              </thead>
              <tbody>
                {state.steps.map((s, i) => (
                  <tr key={i} className="border-t border-ink-100 align-top dark:border-white/10">
                    <td className="py-1.5 pr-3"><Badge tone={ACTION_LABEL[s.action].tone}>{ACTION_LABEL[s.action].label}</Badge></td>
                    <td className="pr-3 font-mono">{s.type}</td>
                    <td className="pr-3 font-mono">{s.name}</td>
                    <td className="max-w-xs break-all pr-3 font-mono">{s.value}</td>
                    <td className="max-w-xs break-all pr-3 font-mono text-ink-400">{s.current ?? "–"}</td>
                    <td className="text-ink-600 dark:text-ink-200">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.applicable ? (
            <StateForm action={apply}>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirm" className="mt-1" />
                <span>Ich bestätige, dass die markierten Einträge bei {provider} angelegt bzw. geändert werden. Bestehende Einträge werden nicht gelöscht.</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="keep" className="mt-1" />
                <span>Zugangsdaten verschlüsselt behalten (für spätere Korrekturen). Ohne Haken werden sie nach dem Schreiben gelöscht.</span>
              </label>
              <Submit>{state.changes ? "Einträge jetzt schreiben" : "Prüfung starten"}</Submit>
            </StateForm>
          ) : (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">Es gibt Konflikte mit bestehenden Einträgen. Bitte diese zuerst beim Anbieter lösen oder einen anderen Hostnamen wählen.</p>
          )}
        </div>
      )}
      {hasStored && !state.steps && <p className="text-xs text-ink-400">Zugangsdaten sind gespeichert (verschlüsselt).</p>}
    </div>
  );
}
