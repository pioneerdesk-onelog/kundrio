// Zeitzonen-Hilfen ohne Abhängigkeiten (Intl). Eingaben aus <input type="datetime-local"> sind Ortszeit.

import { TIME_ZONE } from "./config";

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Versatz der Zeitzone zu UTC in Minuten zum Zeitpunkt d (z. B. +120 im Sommer für Berlin). */
export function tzOffsetMinutes(d: Date, tz = TIME_ZONE): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - d.getTime()) / 60000);
}

/** "2026-10-08T14:30" in Zeitzone tz → UTC-Date. Ungültig → null. */
export function zonedLocalToUtc(local: string, tz = TIME_ZONE): Date | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // zweimal anwenden, damit Sommer-/Winterzeitwechsel korrekt sind
  let utc = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  utc = guess - tzOffsetMinutes(new Date(utc), tz) * 60000;
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC-Date → "YYYY-MM-DDTHH:mm:ss" als Ortszeit in tz (für dateTime+timeZone-Felder der APIs). */
export function utcToZonedLocal(d: Date, tz = TIME_ZONE): string {
  const p = parts(d, tz);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}:${z(p.s)}`;
}

/** Für datetime-local-Felder (ohne Sekunden). */
export function toDatetimeLocal(d: Date, tz = TIME_ZONE): string {
  return utcToZonedLocal(d, tz).slice(0, 16);
}

export function formatRange(start: Date, end: Date, tz = TIME_ZONE): string {
  const day = new Intl.DateTimeFormat("de-DE", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(start);
  const t = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day}, ${t(start)}–${t(end)} Uhr`;
}
