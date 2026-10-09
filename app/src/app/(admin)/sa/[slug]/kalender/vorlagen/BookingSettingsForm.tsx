"use client";

import { useActionState } from "react";
import { btnCls, inputCls, labelCls } from "@/components/ui";
import type { TplState } from "./actions";

type Day = { key: string; label: string; on: boolean; text: string };
type Question = { label: string; type: "text" | "textarea"; required: boolean };

export type BookingValues = {
  bookingEnabled: boolean;
  bookingSlug: string;
  days: Day[];
  zeitzone: string;
  feiertage: boolean;
  minNoticeHours: number;
  maxDaysAhead: number;
  slotIntervalMin: number;
  bufferMin: number;
  confirmationText: string;
  hostUserIds: string[];
  questions: Question[];
};

export function BookingSettingsForm({
  action,
  values,
  hosts,
  canEdit,
  bookingUrl,
  blockPath,
}: {
  action: (prev: TplState, fd: FormData) => Promise<TplState>;
  values: BookingValues;
  hosts: { id: string; name: string; calendar: string | null }[];
  canEdit: boolean;
  bookingUrl: string | null;
  blockPath: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const qs = [...values.questions, ...Array.from({ length: Math.max(0, 5 - values.questions.length) }, () => ({ label: "", type: "text" as const, required: false }))].slice(0, 5);
  const snippet = bookingUrl
    ? `<iframe src="${bookingUrl}?einbettung=1" title="Termin buchen" style="width:100%;min-height:720px;border:0" loading="lazy"></iframe>`
    : "";

  return (
    <form action={formAction} className="space-y-5">
      <fieldset disabled={!canEdit} className="space-y-5">
        <label className="flex items-center gap-2 text-[15px] font-medium">
          <input type="checkbox" name="bookingEnabled" defaultChecked={values.bookingEnabled} /> Öffentlich buchbar
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Adresse der Buchungsseite</span>
            <input name="bookingSlug" defaultValue={values.bookingSlug} placeholder="z. B. erstgespraech" className={inputCls} pattern="[a-z0-9-]*" maxLength={60} />
            <span className="mt-1 block text-xs text-ink-400">Nur Kleinbuchstaben, Ziffern und Bindestrich.</span>
          </label>
          <label className="block">
            <span className={labelCls}>Zeitzone der Wochenzeiten</span>
            <input name="zeitzone" defaultValue={values.zeitzone} className={inputCls} />
          </label>
        </div>

        <div>
          <span className={labelCls}>Wochenzeiten (z. B. „09:00-12:00, 13:00-17:00“)</span>
          <div className="space-y-2">
            {values.days.map((d) => (
              <div key={d.key} className="grid grid-cols-[140px_1fr] items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={`day_${d.key}`} defaultChecked={d.on} /> {d.label}
                </label>
                <input name={`hours_${d.key}`} defaultValue={d.text} aria-label={`Zeiten ${d.label}`} className={inputCls} />
              </div>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="feiertage" defaultChecked={values.feiertage} /> An bundesweiten Feiertagen nicht buchbar
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className={labelCls}>Vorlauf (Stunden)</span>
            <input name="minNoticeHours" type="number" min={0} max={720} defaultValue={values.minNoticeHours} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Buchbar bis (Tage im Voraus)</span>
            <input name="maxDaysAhead" type="number" min={1} max={90} defaultValue={values.maxDaysAhead} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Raster (Minuten)</span>
            <select name="slotIntervalMin" defaultValue={String(values.slotIntervalMin)} className={inputCls}>
              {[15, 20, 30, 45, 60, 90, 120].map((n) => (
                <option key={n} value={n}>{n} min</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-sm text-ink-400 dark:text-ink-200">Puffer vor/nach Terminen: {values.bufferMin} min (in der Vorlage oben einstellbar).</p>

        <div>
          <span className={labelCls}>Gastgeber (Rundlauf – leer = Admins des Sub-Accounts)</span>
          <div className="grid gap-1 sm:grid-cols-2">
            {hosts.map((h) => (
              <label key={h.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="hostUserIds" value={h.id} defaultChecked={values.hostUserIds.includes(h.id)} />
                {h.name}
                <span className="text-xs text-ink-400">{h.calendar ? `(${h.calendar} verbunden)` : "(kein Kalender – nur CRM-Termine)"}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <span className={labelCls}>Zusatzfragen (optional)</span>
          <div className="space-y-2">
            {qs.map((q, k) => (
              <div key={k} className="grid grid-cols-[1fr_140px_100px] items-center gap-2">
                <input name={`q_label_${k}`} defaultValue={q.label} placeholder={`Frage ${k + 1}`} aria-label={`Frage ${k + 1}`} className={inputCls} maxLength={200} />
                <select name={`q_type_${k}`} defaultValue={q.type} aria-label={`Art der Frage ${k + 1}`} className={inputCls}>
                  <option value="text">Kurztext</option>
                  <option value="textarea">Langtext</option>
                </select>
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name={`q_req_${k}`} defaultChecked={q.required} /> Pflicht
                </label>
              </div>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={labelCls}>Bestätigungstext (erscheint nach der Buchung und in der Bestätigungsmail)</span>
          <textarea name="confirmationText" defaultValue={values.confirmationText} rows={3} maxLength={2000} className={inputCls} />
        </label>

        {canEdit && (
          <button className={btnCls} disabled={pending}>
            {pending ? "Speichert …" : "Buchung speichern"}
          </button>
        )}
      </fieldset>
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{state.ok}</p>}

      {bookingUrl && (
        <div className="space-y-2 rounded-lg bg-sand-100 p-3 text-sm dark:bg-white/5">
          <p>
            Buchungsseite:{" "}
            <a href={bookingUrl} target="_blank" rel="noreferrer" className="font-medium text-accent-500 dark:text-accent-100 hover:underline">
              {bookingUrl}
            </a>{" "}
            {!values.bookingEnabled && <span className="text-amber-700">(noch nicht öffentlich)</span>}
          </p>
          {blockPath && <p>Für den Landingpage-Block „Termin buchen“: <code>{blockPath}</code></p>}
          <label className="block">
            <span className="text-xs text-ink-400">Einbettung auf einer Website</span>
            <textarea readOnly value={snippet} rows={2} className={`${inputCls} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
          </label>
        </div>
      )}
    </form>
  );
}
