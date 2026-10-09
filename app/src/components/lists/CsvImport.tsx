"use client";

import { useActionState } from "react";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import type { CsvState } from "@/app/(admin)/sa/[slug]/listen/actions";

const TARGETS: [string, string][] = [
  ["skip", "– nicht übernehmen –"],
  ["email", "E-Mail"],
  ["firstName", "Vorname"],
  ["lastName", "Nachname"],
  ["phone", "Telefon"],
  ["company", "Firma"],
  ["tags", "Tags (; getrennt)"],
  ["lists", "Listen (; getrennt)"],
  ["blacklisted", "Abgemeldet/gesperrt (ja/nein)"],
  ["consent", "Einwilligung (ja/nein)"],
];

const FORMAT_LABEL = { brevo: "Brevo-Export erkannt", hubspot: "HubSpot-Export erkannt", generic: "Allgemeine CSV" };

export function CsvImport({ action, lists }: { action: (prev: CsvState, fd: FormData) => Promise<CsvState>; lists: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(action, { step: "upload" } as CsvState);

  if (state.step === "done" && state.result) {
    const r = state.result;
    return (
      <div className="space-y-3" role="status">
        <p className="text-[15px]">
          Fertig: <strong>{r.created}</strong> neu, <strong>{r.updated}</strong> ergänzt, {r.skipped} ohne gültige E-Mail übersprungen,
          {" "}{r.suppressed} gesperrt, {r.listsCreated} Listen neu angelegt.
        </p>
        <form action={formAction}><input type="hidden" name="reset" value="1" /><button className={btnGhostCls}>Weitere Datei importieren</button></form>
      </div>
    );
  }

  if (state.step === "mapping" && state.header) {
    return (
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="csv" value={state.csv} />
        <p className="text-[15px]"><strong>{state.format ? FORMAT_LABEL[state.format] : ""}</strong> · {state.rows} Zeilen. Bitte Zuordnung prüfen:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-400"><tr><th className="py-1 pr-3 font-medium">Spalte</th><th className="pr-3 font-medium">Beispiel</th><th className="font-medium">Übernehmen als</th></tr></thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {state.header.map((h, i) => {
                const m = state.mapping?.[i] ?? "skip";
                const isAttr = m.startsWith("attr:");
                return (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 font-medium">{h || <em>(leer)</em>}</td>
                    <td className="max-w-[16rem] truncate pr-3 text-ink-600 dark:text-ink-200">{state.sample?.[0]?.[i]}</td>
                    <td>
                      <label className="sr-only" htmlFor={`map_${i}`}>Ziel für {h}</label>
                      <select id={`map_${i}`} name={`map_${i}`} defaultValue={m} className={inputCls}>
                        {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        <option value={isAttr ? m : `attr:${h}`}>Eigenes Feld: {isAttr ? m.slice(5) : h.toUpperCase().replace(/\s+/g, "_")}</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {lists.length > 0 && (
          <label className="block max-w-sm"><span className={labelCls}>Zusätzlich in Liste aufnehmen (optional)</span>
            <select name="listId" className={inputCls} defaultValue=""><option value="">– keine –</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </label>
        )}
        <label className="flex items-start gap-2 text-[15px]">
          <input type="checkbox" name="consentConfirmed" className="mt-1" />
          <span>Für Zeilen mit „Einwilligung = ja“ liegt ein Nachweis (z. B. Double-Opt-in) vor. Ohne Haken wird <strong>keine</strong> Einwilligung übernommen.</span>
        </label>
        {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
        <div className="flex gap-2">
          <button className={btnCls} disabled={pending}>{pending ? "Importiere …" : `${state.rows} Zeilen importieren`}</button>
        </div>
        <p className="text-sm text-ink-400">Vorhandene Kontakte (gleiche E-Mail) werden nur ergänzt, nie überschrieben. Abgemeldete landen auf der Sperrliste.</p>
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <label className="block"><span className={labelCls}>CSV-Datei (Brevo-, HubSpot- oder eigener Export, max. 5 MB)</span>
        <input type="file" name="file" accept=".csv,text/csv" className="block text-[15px]" /></label>
      <label className="block"><span className={labelCls}>oder CSV-Text einfügen</span>
        <textarea name="text" rows={4} className={`${inputCls} font-mono text-sm`} /></label>
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
      <button className={btnCls} disabled={pending}>{pending ? "Lese …" : "Vorschau & Zuordnung"}</button>
    </form>
  );
}
