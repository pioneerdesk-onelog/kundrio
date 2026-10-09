"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { BookState, SlotDto } from "./actions";

type Question = { key: string; label: string; type: "text" | "textarea"; required: boolean };

const input =
  "w-full rounded-md border border-black/20 bg-white px-3 py-2 text-[16px] text-[#1f2a37] outline-none focus:border-[var(--bk-primary)] focus:ring-2 focus:ring-[var(--bk-primary)]/30";

function useVisitorTz() {
  const [tz, setTz] = useState("Europe/Berlin");
  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin");
    } catch {
      /* Standard behalten */
    }
  }, []);
  return tz;
}

export function BookingWidget({
  mode,
  load,
  action,
  questions = [],
  formTs,
  durationMin,
  privacyHint,
  submitLabel,
}: {
  mode: "book" | "reschedule";
  load: () => Promise<{ slots: SlotDto[]; error?: string }>;
  action: (prev: BookState, fd: FormData) => Promise<BookState>;
  questions?: Question[];
  formTs?: string;
  durationMin: number;
  privacyHint?: string;
  submitLabel: string;
}) {
  const tz = useVisitorTz();
  const [slots, setSlots] = useState<SlotDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(action, {});

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => {
        if (cancelled) return;
        setSlots(r.slots);
        setLoadError(r.error ?? null);
      })
      .catch(() => !cancelled && setLoadError("Freie Zeiten konnten nicht geladen werden."));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const fmtDayKey = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }), [tz]);
  const fmtDay = useMemo(() => new Intl.DateTimeFormat("de-DE", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit" }), [tz]);
  const fmtTime = useMemo(() => new Intl.DateTimeFormat("de-DE", { timeZone: tz, hour: "2-digit", minute: "2-digit" }), [tz]);
  const fmtLong = useMemo(() => new Intl.DateTimeFormat("de-DE", { timeZone: tz, weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }), [tz]);

  const byDay = useMemo(() => {
    const g = new Map<string, SlotDto[]>();
    for (const s of slots ?? []) {
      const k = fmtDayKey.format(new Date(s.start));
      g.set(k, [...(g.get(k) ?? []), s]);
    }
    return g;
  }, [slots, fmtDayKey]);
  const days = [...byDay.keys()];

  if (slots === null && !loadError) return <p role="status" className="text-[16px]">Freie Zeiten werden geladen …</p>;
  if (loadError) return <p role="alert" className="text-[16px] text-red-700">{loadError}</p>;
  if (days.length === 0) return <p className="text-[16px]">Derzeit sind leider keine freien Zeiten verfügbar. Bitte versuchen Sie es später erneut.</p>;

  const current = day ?? days[0];
  return (
    <div className="space-y-6">
      <p className="text-sm opacity-75">
        Zeiten in Ihrer Zeitzone: <strong>{tz}</strong> · Dauer {durationMin} Minuten
      </p>

      <fieldset>
        <legend className="mb-2 font-semibold">1. Tag wählen</legend>
        <div className="flex flex-wrap gap-2">
          {days.map((d) => {
            const first = byDay.get(d)![0];
            const active = d === current;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setDay(d);
                  setStart(null);
                }}
                className={`rounded-md border px-3 py-2 text-[15px] ${active ? "border-[var(--bk-primary)] bg-[var(--bk-primary)] text-[color:var(--bk-on-primary)]" : "border-black/20 bg-white hover:border-[var(--bk-primary)]"}`}
              >
                {fmtDay.format(new Date(first.start))}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-semibold">2. Uhrzeit wählen</legend>
        <div className="flex flex-wrap gap-2">
          {(byDay.get(current) ?? []).map((s) => {
            const active = s.start === start;
            return (
              <button
                key={s.start}
                type="button"
                aria-pressed={active}
                onClick={() => setStart(s.start)}
                className={`rounded-md border px-3 py-2 text-[15px] tabular-nums ${active ? "border-[var(--bk-primary)] bg-[var(--bk-primary)] text-[color:var(--bk-on-primary)]" : "border-black/20 bg-white hover:border-[var(--bk-primary)]"}`}
              >
                {fmtTime.format(new Date(s.start))}
              </button>
            );
          })}
        </div>
      </fieldset>

      {start && (
        <form action={formAction} className="space-y-4" aria-label={mode === "book" ? "Buchungsformular" : "Umbuchen"}>
          <input type="hidden" name="start" value={start} />
          <p className="rounded-md bg-black/[0.04] p-3 text-[15px]">
            Gewählt: <strong>{fmtLong.format(new Date(start))} Uhr</strong>
          </p>
          {mode === "book" && (
            <>
              <input type="text" name="website_url" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
              {formTs && <input type="hidden" name="_ts" value={formTs} />}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Vorname *</span>
                  <input name="firstName" required maxLength={100} autoComplete="given-name" className={input} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Nachname *</span>
                  <input name="lastName" required maxLength={100} autoComplete="family-name" className={input} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">E-Mail *</span>
                  <input name="email" type="email" required maxLength={200} autoComplete="email" className={input} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Telefon (optional)</span>
                  <input name="phone" type="tel" maxLength={40} autoComplete="tel" className={input} />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Firma (optional)</span>
                  <input name="company" maxLength={200} autoComplete="organization" className={input} />
                </label>
              </div>
              {questions.map((q) => (
                <label key={q.key} className="block">
                  <span className="mb-1 block text-sm font-medium">
                    {q.label}
                    {q.required ? " *" : ""}
                  </span>
                  {q.type === "textarea" ? (
                    <textarea name={`q_${q.key}`} required={q.required} rows={3} maxLength={2000} className={input} />
                  ) : (
                    <input name={`q_${q.key}`} required={q.required} maxLength={300} className={input} />
                  )}
                </label>
              ))}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="privacy" required className="mt-1" />
                <span>{privacyHint ?? "Ich bin einverstanden, dass meine Angaben zur Terminvereinbarung verarbeitet werden."} *</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="newsletter" className="mt-1" />
                <span>Ich möchte zusätzlich Neuigkeiten per E-Mail erhalten (Bestätigung per E-Mail, jederzeit abmeldbar). Optional.</span>
              </label>
            </>
          )}
          {state.error && (
            <p role="alert" className="text-[15px] text-red-700">
              {state.error}
            </p>
          )}
          <button
            disabled={pending}
            className="inline-flex items-center justify-center rounded-lg bg-[var(--bk-primary)] px-6 py-3 text-[16px] font-semibold text-[color:var(--bk-on-primary)] shadow-sm hover:brightness-110 disabled:opacity-60"
          >
            {pending ? "Wird gebucht …" : submitLabel}
          </button>
        </form>
      )}
    </div>
  );
}
