"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { btnCls, inputCls, labelCls } from "@/components/ui";
import { PLACEHOLDERS, renderMeetingTemplate } from "@/lib/calendar/template";
import { VIDEO_LABEL, VIDEO_PROVIDERS } from "@/lib/calendar/config";

type State = { error?: string; ok?: string };
type Values = {
  name: string;
  titleTemplate: string;
  description: string;
  durationMin: number;
  bufferMin: number;
  videoProvider: string;
  location: string;
  reminders: string;
  addToTeamCalendar: boolean;
  active: boolean;
};

const SAMPLE = {
  contact: { FIRSTNAME: "Anna", LASTNAME: "Berger", NAME: "Anna Berger", EMAIL: "anna.berger@example.com" },
  company: { name: "Berger Maschinenbau GmbH" },
  deal: { title: "Wartungsvertrag 2027" },
  owner: { name: "Ihr Name", email: "sie@example.com" },
  meeting: { date: "Do., 08.10.2026, 10:00–10:30 Uhr", duration: "30", joinUrl: "https://meet.google.com/abc-defg-hij", workspace: "Ihr Sub-Account" },
};

export function MeetingTypeForm({
  action,
  values,
  canEdit,
}: {
  action: (prev: State, fd: FormData) => Promise<State>;
  values?: Partial<Values>;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [title, setTitle] = useState(values?.titleTemplate ?? "Erstgespräch {{ company.name }}");
  const [desc, setDesc] = useState(values?.description ?? "");
  const [focus, setFocus] = useState<"title" | "desc">("desc");
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => ({ title: renderMeetingTemplate(title, SAMPLE), desc: renderMeetingTemplate(desc, SAMPLE) }), [title, desc]);

  function insert(token: string) {
    const el = focus === "title" ? titleRef.current : descRef.current;
    const cur = focus === "title" ? title : desc;
    const pos = el?.selectionStart ?? cur.length;
    const next = cur.slice(0, pos) + token + cur.slice(el?.selectionEnd ?? pos);
    if (focus === "title") setTitle(next);
    else setDesc(next);
  }

  return (
    <form action={formAction} className="grid gap-4 lg:grid-cols-2">
      <fieldset disabled={!canEdit || pending} className="space-y-3">
        <label className="block">
          <span className={labelCls}>Name der Vorlage</span>
          <input name="name" required maxLength={80} defaultValue={values?.name} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Titel der Einladung</span>
          <input ref={titleRef} name="titleTemplate" required maxLength={200} value={title} onFocus={() => setFocus("title")} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Einladungstext</span>
          <textarea ref={descRef} name="description" rows={8} maxLength={5000} value={desc} onFocus={() => setFocus("desc")} onChange={(e) => setDesc(e.target.value)} className={inputCls} />
        </label>
        <div className="flex flex-wrap gap-1.5" aria-label="Platzhalter einfügen">
          {PLACEHOLDERS.map((p) => (
            <button key={p.key} type="button" onClick={() => insert(p.key)} className="rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-sand-100 dark:border-white/15 dark:hover:bg-white/10" title={p.key}>
              + {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>Dauer (Minuten)</span>
            <input name="durationMin" type="number" min={5} max={600} required defaultValue={values?.durationMin ?? 30} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Puffer (Minuten)</span>
            <input name="bufferMin" type="number" min={0} max={120} defaultValue={values?.bufferMin ?? 0} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Video</span>
            <select name="videoProvider" defaultValue={values?.videoProvider ?? "google_meet"} className={inputCls}>
              {VIDEO_PROVIDERS.map((v) => (
                <option key={v} value={v}>
                  {VIDEO_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Erinnerungen (Min. vorher)</span>
            <input name="reminders" defaultValue={values?.reminders ?? "1440, 15"} placeholder="1440, 15" className={inputCls} />
          </label>
        </div>
        <label className="block">
          <span className={labelCls}>Ort (bei „Vor Ort“, „Telefon“ oder OpenTalk-Raumlink)</span>
          <input name="location" maxLength={300} defaultValue={values?.location} className={inputCls} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="addToTeamCalendar" defaultChecked={values?.addToTeamCalendar ?? true} /> Zusätzlich im Teamkalender eintragen
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={values?.active ?? true} /> Aktiv
        </label>
        {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
        {state.ok && <p role="status" className="text-sm text-green-700 dark:text-green-300">{state.ok}</p>}
        {canEdit && <button className={btnCls}>{pending ? "Speichern …" : "Speichern"}</button>}
      </fieldset>
      <div className="rounded-lg border border-ink-100 bg-sand-50 p-4 text-sm dark:border-white/10 dark:bg-white/5" aria-live="polite">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Vorschau (Beispieldaten)</div>
        <div className="mb-2 font-semibold">{preview.title || "–"}</div>
        <pre className="whitespace-pre-wrap font-sans text-ink-700 dark:text-ink-100">{preview.desc || "–"}</pre>
      </div>
    </form>
  );
}
