"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { VIDEO_LABEL, type VideoProvider } from "@/lib/calendar/config";

type MeetingState = { error?: string; ok?: string; joinUrl?: string | null; warnings?: string[] };
export type MeetingTypeOpt = { id: string; name: string; durationMin: number; bufferMin: number; videoProvider: string; addToTeamCalendar: boolean };
type Opt = { id: string; label: string };
type Slots = { source: string; slots: { value: string; label: string }[]; error?: string };

export function MeetingDialog({
  action,
  suggest,
  types,
  contacts,
  colleagues,
  preselectedContactIds,
  dealId,
  connected,
  hasTeamCalendar,
  label = "Termin mit Video-Call",
}: {
  action: (prev: MeetingState, fd: FormData) => Promise<MeetingState>;
  suggest: (durationMin: number, bufferMin: number) => Promise<Slots>;
  types: MeetingTypeOpt[];
  contacts: Opt[];
  colleagues: Opt[];
  preselectedContactIds: string[];
  dealId?: string | null;
  connected: { google: boolean; microsoft: boolean };
  hasTeamCalendar: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(action, {});
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const type = types.find((t) => t.id === typeId);
  const [duration, setDuration] = useState(type?.durationMin ?? 30);
  const initialVideo = (v?: string): VideoProvider => {
    if (v === "google_meet" && !connected.google) return "jitsi";
    if (v === "ms_teams" && !connected.microsoft) return "jitsi";
    return (v as VideoProvider) ?? "jitsi";
  };
  const [video, setVideo] = useState<VideoProvider>(initialVideo(type?.videoProvider));
  const [start, setStart] = useState("");
  const [slots, setSlots] = useState<Slots | null>(null);
  const [loading, startLoading] = useTransition();

  function chooseType(id: string) {
    setTypeId(id);
    const t = types.find((x) => x.id === id);
    if (t) {
      setDuration(t.durationMin);
      setVideo(initialVideo(t.videoProvider));
    }
  }

  const videoOptions: VideoProvider[] = ["google_meet", "ms_teams", "jitsi", "opentalk", "phone", "onsite", "none"];
  const disabledVideo = (v: VideoProvider) => (v === "google_meet" && !connected.google) || (v === "ms_teams" && !connected.microsoft);

  return (
    <>
      <button type="button" className={btnCls} onClick={() => ref.current?.showModal()}>
        {label}
      </button>
      <dialog ref={ref} aria-labelledby="meeting-dialog-title" className="w-[min(46rem,95vw)] rounded-xl border border-ink-100 bg-white p-0 text-ink-900 shadow-xl backdrop:bg-black/40 dark:border-white/10 dark:bg-ink-900 dark:text-ink-50">
        <form action={formAction} className="space-y-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="meeting-dialog-title" className="font-display text-2xl">
              Termin planen
            </h2>
            <button type="button" className={btnGhostCls} onClick={() => ref.current?.close()} aria-label="Schließen">
              ✕
            </button>
          </div>
          {dealId && <input type="hidden" name="dealId" value={dealId} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>Vorlage</span>
              <select name="meetingTypeId" value={typeId} onChange={(e) => chooseType(e.target.value)} className={inputCls}>
                <option value="">– ohne Vorlage –</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.durationMin} min)
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Titel (leer = aus Vorlage)</span>
              <input name="title" maxLength={200} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Beginn</span>
              <input name="start" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Dauer (Minuten)</span>
              <input name="durationMin" type="number" min={5} max={600} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 30)} className={inputCls} />
            </label>
          </div>
          <div>
            <button
              type="button"
              className={btnGhostCls}
              disabled={loading}
              onClick={() => startLoading(async () => setSlots(await suggest(duration, type?.bufferMin ?? 0)))}
            >
              {loading ? "Suche freie Zeiten …" : "Freie Zeiten vorschlagen"}
            </button>
            {slots && (
              <div className="mt-2">
                {slots.error && <p className="text-sm text-red-700 dark:text-red-300">{slots.error}</p>}
                <p className="mb-1 text-xs text-ink-400">
                  Quelle: {slots.source === "crm" ? "nur CRM-Termine (kein Kalender verbunden)" : slots.source === "google" ? "Google Kalender" : "Microsoft 365"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {slots.slots.length === 0 && <span className="text-sm text-ink-400">Keine freien Zeiten in den nächsten 14 Tagen.</span>}
                  {slots.slots.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStart(s.value)}
                      aria-pressed={start === s.value}
                      className={`rounded-md border px-2 py-1 text-xs ${start === s.value ? "border-accent-500 bg-accent-50 dark:bg-accent-500/20" : "border-ink-200 dark:border-white/15"}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <fieldset>
            <legend className={labelCls}>Video</legend>
            <div className="flex flex-wrap gap-2">
              {videoOptions.map((v) => (
                <label key={v} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${disabledVideo(v) ? "opacity-50" : ""} border-ink-200 dark:border-white/15`}>
                  <input type="radio" name="videoProvider" value={v} checked={video === v} disabled={disabledVideo(v)} onChange={() => setVideo(v)} />
                  {VIDEO_LABEL[v]}
                </label>
              ))}
            </div>
            {(!connected.google || !connected.microsoft) && (
              <p className="mt-1 text-xs text-ink-400">
                {!connected.google && "Google Meet braucht eine Google-Kalenderverbindung. "}
                {!connected.microsoft && "Teams braucht eine Microsoft-Verbindung. "}
                <a href="/konto/kalender" className="text-accent-500 dark:text-accent-100 hover:underline">
                  Kalender verbinden
                </a>
                . Ohne Verbindung: Einladung per .ics-Mail.
              </p>
            )}
          </fieldset>
          {(video === "onsite" || video === "phone" || video === "opentalk") && (
            <label className="block">
              <span className={labelCls}>{video === "opentalk" ? "OpenTalk-Raumlink (https://…)" : video === "phone" ? "Telefonnummer" : "Adresse"}</span>
              <input name="location" maxLength={300} required={video === "opentalk"} className={inputCls} />
            </label>
          )}
          <fieldset>
            <legend className={labelCls}>Kontakte (erhalten die Einladung)</legend>
            <select name="contactIds" multiple size={Math.min(6, Math.max(3, contacts.length))} defaultValue={preselectedContactIds} className={inputCls}>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-400">Mehrfachauswahl mit Strg/⌘.</p>
          </fieldset>
          {colleagues.length > 0 && (
            <fieldset>
              <legend className={labelCls}>Kolleginnen und Kollegen</legend>
              <div className="flex flex-wrap gap-2">
                {colleagues.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="internalUserIds" value={c.id} /> {c.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="addToTeamCalendar" defaultChecked={type?.addToTeamCalendar ?? true} disabled={!hasTeamCalendar} />
            Im Teamkalender eintragen {!hasTeamCalendar && <span className="text-ink-400">(kein Teamkalender festgelegt)</span>}
          </label>
          <details>
            <summary className="cursor-pointer text-sm text-ink-600 dark:text-ink-200">Einladungstext anpassen (leer = Vorlage)</summary>
            <textarea name="description" rows={5} maxLength={5000} className={`${inputCls} mt-2`} />
          </details>
          {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
          {state.ok && (
            <div role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
              {state.ok}
              {state.joinUrl && (
                <div className="mt-1 break-all">
                  Link: <a href={state.joinUrl} target="_blank" rel="noreferrer" className="underline">{state.joinUrl}</a>
                </div>
              )}
              {state.warnings?.map((w) => (
                <div key={w} className="mt-1 text-amber-800 dark:text-amber-200">Hinweis: {w}</div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhostCls} onClick={() => ref.current?.close()}>
              Schließen
            </button>
            <button className={btnCls} disabled={pending}>
              {pending ? "Wird angelegt …" : "Termin anlegen und einladen"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
