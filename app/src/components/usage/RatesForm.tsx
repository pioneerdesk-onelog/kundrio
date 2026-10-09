"use client";

import { useActionState } from "react";
import { saveRatesAction, type RatesState } from "@/app/(admin)/kosten/actions";
import { btnCls, inputCls, labelCls } from "@/components/ui";
import { AI_PROFILES, type CostRates } from "@/lib/usage-cost";

const show = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));

function Field({ name, label, unit, value, hint }: { name: string; label: string; unit: string; value: number | null; hint?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <div className="flex items-center gap-2">
        <input name={name} defaultValue={show(value)} inputMode="decimal" placeholder="Preis beim Anbieter eintragen" className={inputCls} aria-describedby={hint ? `${name}-hint` : undefined} />
        <span className="shrink-0 text-sm text-ink-400 dark:text-ink-200">{unit}</span>
      </div>
      {hint && <span id={`${name}-hint`} className="mt-1 block text-xs text-ink-400 dark:text-ink-200">{hint}</span>}
    </label>
  );
}

export function RatesForm({ rates }: { rates: CostRates }) {
  const [state, action, pending] = useActionState<RatesState, FormData>(saveRatesAction, {});
  return (
    <form action={action} className="space-y-6">
      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Speicher & Versand</legend>
        <Field name="dbEurPerGbMonth" label="Datenbank" unit="€ / GB · Monat" value={rates.dbEurPerGbMonth} />
        <Field name="objectEurPerGbMonth" label="Objektspeicher" unit="€ / GB · Monat" value={rates.objectEurPerGbMonth} />
        <Field name="emailEurPer1000" label="E-Mail-Relay" unit="€ / 1.000 Mails" value={rates.emailEurPer1000} />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">KI (je Anbieter-Profil, € je 1 Mio. Tokens)</legend>
        <label className="block max-w-sm">
          <span className={labelCls}>Für die Berechnung verwenden</span>
          <select name="aiProfile" defaultValue={rates.aiProfile} className={inputCls}>
            {Object.entries(AI_PROFILES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead><tr className="text-sm text-ink-400 dark:text-ink-200"><th className="py-1 pr-3 font-medium">Profil</th><th className="py-1 pr-3 font-medium">Eingabe €/1 Mio.</th><th className="py-1 font-medium">Ausgabe €/1 Mio.</th></tr></thead>
            <tbody>
              {(Object.keys(AI_PROFILES) as (keyof typeof AI_PROFILES)[]).map((k) => (
                <tr key={k} className="border-t border-ink-100 dark:border-white/10">
                  <th scope="row" className="py-2 pr-3 font-normal">{AI_PROFILES[k]}</th>
                  <td className="py-2 pr-3"><input aria-label={`${AI_PROFILES[k]} Eingabe`} name={`ai.${k}.in`} defaultValue={show(rates.ai[k].inEurPer1M)} inputMode="decimal" placeholder="eintragen" className={inputCls} /></td>
                  <td className="py-2"><input aria-label={`${AI_PROFILES[k]} Ausgabe`} name={`ai.${k}.out`} defaultValue={show(rates.ai[k].outEurPer1M)} inputMode="decimal" placeholder="eintragen" className={inputCls} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-400 dark:text-ink-200">Lokal: Strom und GPU-Abschreibung grob auf Tokens umlegen. Bei Cloud-Anbietern die aktuelle Preisliste verwenden – hier sind bewusst keine Preise vorbelegt.</p>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold">Fixkosten Plattform (pro Monat)</legend>
        <Field name="computeEurPerMonth" label="Rechenleistung" unit="€ / Monat" value={rates.computeEurPerMonth} />
        <Field name="backupEurPerMonth" label="Backups" unit="€ / Monat" value={rates.backupEurPerMonth} />
        <Field name="monitoringEurPerMonth" label="Monitoring" unit="€ / Monat" value={rates.monitoringEurPerMonth} />
        <label className="block">
          <span className={labelCls}>Verteilung</span>
          <select name="fixedAllocation" defaultValue={rates.fixedAllocation} className={inputCls}>
            <option value="equal">gleichmäßig je Sub-Account</option>
            <option value="usage">nach Nutzung (variabler Anteil)</option>
          </select>
        </label>
      </fieldset>

      <div className="flex items-center gap-3">
        <button className={btnCls} disabled={pending}>{pending ? "Speichern …" : "Kostensätze speichern"}</button>
        <span role="status" className={state.error ? "text-sm text-red-700 dark:text-red-300" : "text-sm text-emerald-700 dark:text-emerald-300"}>
          {state.error ?? state.ok}
        </span>
      </div>
    </form>
  );
}
