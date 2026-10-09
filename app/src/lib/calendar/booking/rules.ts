// Öffentlicher Buchungskalender – reine Regeln (ohne DB): Wochenzeiten, Feiertage, freie Zeiten.
// Alle Zeiten werden in der Zeitzone der Vorlage (Standard Europe/Berlin) gedacht und in UTC gerechnet,
// damit Sommer-/Winterzeitwechsel (z. B. 25.10.2026) korrekt sind.

import { TIME_ZONE } from "../config";
import { utcToZonedLocal, zonedLocalToUtc } from "../time";

export const WEEKDAYS = ["mo", "di", "mi", "do", "fr", "sa", "so"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABEL: Record<Weekday, string> = { mo: "Montag", di: "Dienstag", mi: "Mittwoch", do: "Donnerstag", fr: "Freitag", sa: "Samstag", so: "Sonntag" };

export type Range = [string, string]; // ["09:00","12:00"]
export type Availability = { hours: Record<Weekday, Range[]>; zeitzone: string; feiertage: boolean };

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const DEFAULT_AVAILABILITY: Availability = {
  hours: { mo: [["09:00", "17:00"]], di: [["09:00", "17:00"]], mi: [["09:00", "17:00"]], do: [["09:00", "17:00"]], fr: [["09:00", "15:00"]], sa: [], so: [] },
  zeitzone: TIME_ZONE,
  feiertage: true,
};

function validRanges(v: unknown): Range[] {
  if (!Array.isArray(v)) return [];
  const out: Range[] = [];
  for (const r of v) {
    if (!Array.isArray(r) || r.length !== 2) continue;
    const [a, b] = r.map(String);
    if (TIME_RE.test(a) && TIME_RE.test(b) && toMin(a) < toMin(b)) out.push([a, b]);
  }
  return out.sort((x, y) => toMin(x[0]) - toMin(y[0])).slice(0, 6);
}

/** Liest das gespeicherte Json `{ mo:[["09:00","12:00"]], …, zeitzone, feiertage }` tolerant; leer → Standard. */
export function parseAvailability(json: unknown): Availability {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const hasAny = WEEKDAYS.some((d) => Array.isArray(o[d]));
  if (!hasAny) return { ...DEFAULT_AVAILABILITY, zeitzone: typeof o.zeitzone === "string" ? o.zeitzone : TIME_ZONE };
  const hours = Object.fromEntries(WEEKDAYS.map((d) => [d, validRanges(o[d])])) as Record<Weekday, Range[]>;
  const tz = typeof o.zeitzone === "string" && isValidTimeZone(o.zeitzone) ? o.zeitzone : TIME_ZONE;
  return { hours, zeitzone: tz, feiertage: o.feiertage !== false };
}

export function serializeAvailability(a: Availability): Record<string, unknown> {
  return { ...a.hours, zeitzone: a.zeitzone, feiertage: a.feiertage };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** „09:00-12:00, 13:00-17:00“ → Bereiche; Fehlertext bei ungültiger Eingabe. */
export function parseRangesText(text: string): { ranges: Range[]; error?: string } {
  const parts = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const ranges: Range[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return { ranges: [], error: `„${p}“ ist kein Zeitraum (Format 09:00-12:00)` };
    const a = `${m[1].padStart(2, "0")}:${m[2]}`;
    const b = `${m[3].padStart(2, "0")}:${m[4]}`;
    if (!TIME_RE.test(a) || !TIME_RE.test(b) || toMin(a) >= toMin(b)) return { ranges: [], error: `„${p}“: Ende muss nach dem Beginn liegen` };
    ranges.push([a, b]);
  }
  ranges.sort((x, y) => toMin(x[0]) - toMin(y[0]));
  for (let i = 1; i < ranges.length; i++) if (toMin(ranges[i][0]) < toMin(ranges[i - 1][1])) return { ranges: [], error: "Zeiträume überschneiden sich" };
  return { ranges };
}

export const rangesToText = (r: Range[]) => r.map(([a, b]) => `${a}-${b}`).join(", ");

// ---------- Feiertage (bundesweit, DE) ----------

/** Ostersonntag (Gauß/Meeus, gregorianisch). */
export function easterSunday(year: number): { m: number; d: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const addDays = (y: number, m: number, d: number, n: number) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};

/** Bundesweite gesetzliche Feiertage als „YYYY-MM-DD“. Länderspezifische Tage bewusst nicht enthalten. */
export function germanHolidays(year: number): Map<string, string> {
  const e = easterSunday(year);
  return new Map([
    [iso(year, 1, 1), "Neujahr"],
    [addDays(year, e.m, e.d, -2), "Karfreitag"],
    [addDays(year, e.m, e.d, 1), "Ostermontag"],
    [iso(year, 5, 1), "Tag der Arbeit"],
    [addDays(year, e.m, e.d, 39), "Christi Himmelfahrt"],
    [addDays(year, e.m, e.d, 50), "Pfingstmontag"],
    [iso(year, 10, 3), "Tag der Deutschen Einheit"],
    [iso(year, 12, 25), "1. Weihnachtstag"],
    [iso(year, 12, 26), "2. Weihnachtstag"],
  ]);
}

// ---------- freie Zeiten ----------

export type Busy = { start: Date; end: Date };
export type Slot = { start: Date; end: Date; hostIds: string[] };

export type SlotInput = {
  now: Date;
  availability: Availability;
  durationMin: number;
  bufferMin: number;
  slotIntervalMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  hostIds: string[];
  busyByHost: Record<string, Busy[]>;
  /** optional nur diesen lokalen Tagesbereich („YYYY-MM-DD“, inklusiv) berechnen */
  fromDay?: string;
  toDay?: string;
};

/** Wochentag eines lokalen Datums „YYYY-MM-DD“. */
export function weekdayOf(day: string): Weekday {
  const [y, m, d] = day.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sonntag
  return WEEKDAYS[(js + 6) % 7];
}

/** Freie Zeiten: Wochenzeiten ∩ (mind. ein Gastgeber frei inkl. Puffer), ab Vorlauf, bis Zeitraum, ohne Feiertage. */
export function computeSlots(i: SlotInput): Slot[] {
  const tz = i.availability.zeitzone || TIME_ZONE;
  const dur = Math.max(5, i.durationMin) * 60000;
  const buf = Math.max(0, i.bufferMin) * 60000;
  const step = Math.max(5, i.slotIntervalMin) * 60000;
  const earliest = i.now.getTime() + Math.max(0, i.minNoticeHours) * 3600_000;
  const today = utcToZonedLocal(i.now, tz).slice(0, 10);
  const lastDay = addDays(...(today.split("-").map(Number) as [number, number, number]), Math.max(0, i.maxDaysAhead));
  const from = i.fromDay && i.fromDay > today ? i.fromDay : today;
  const to = i.toDay && i.toDay < lastDay ? i.toDay : lastDay;
  if (from > to || i.hostIds.length === 0) return [];

  const holidayCache = new Map<number, Map<string, string>>();
  const isHoliday = (day: string) => {
    const y = Number(day.slice(0, 4));
    if (!holidayCache.has(y)) holidayCache.set(y, germanHolidays(y));
    return holidayCache.get(y)!.has(day);
  };

  const out: Slot[] = [];
  let day = from;
  for (let guard = 0; day <= to && guard < 400; guard++) {
    if (!(i.availability.feiertage && isHoliday(day))) {
      for (const [a, b] of i.availability.hours[weekdayOf(day)] ?? []) {
        const rs = zonedLocalToUtc(`${day}T${a}`, tz);
        const re = zonedLocalToUtc(`${day}T${b}`, tz);
        if (!rs || !re) continue;
        for (let t = rs.getTime(); t + dur <= re.getTime(); t += step) {
          if (t < earliest) continue;
          const s = t - buf;
          const e = t + dur + buf;
          const free = i.hostIds.filter((h) => !(i.busyByHost[h] ?? []).some((x) => x.start.getTime() < e && x.end.getTime() > s));
          if (free.length) out.push({ start: new Date(t), end: new Date(t + dur), hostIds: free });
        }
      }
    }
    const [y, m, d] = day.split("-").map(Number);
    day = addDays(y, m, d, 1);
  }
  return out;
}

/** Slots nach lokalem Tag gruppieren (für die Buchungsseite). */
export function groupByDay(slots: Slot[], tz = TIME_ZONE): Record<string, Slot[]> {
  const g: Record<string, Slot[]> = {};
  for (const s of slots) (g[utcToZonedLocal(s.start, tz).slice(0, 10)] ??= []).push(s);
  return g;
}

/** Schlüssel-Validierung für Zusatzfragen und Buchungsadressen. */
export const BOOKING_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export type BookingQuestion = { key: string; label: string; type: "text" | "textarea"; required: boolean };

export function parseQuestions(json: unknown): BookingQuestion[] {
  if (!Array.isArray(json)) return [];
  const out: BookingQuestion[] = [];
  for (const q of json) {
    if (!q || typeof q !== "object") continue;
    const o = q as Record<string, unknown>;
    const label = String(o.label ?? "").trim().slice(0, 200);
    const key = String(o.key ?? "").trim();
    if (!label || !/^[a-z0-9_]{1,40}$/.test(key)) continue;
    out.push({ key, label, type: o.type === "textarea" ? "textarea" : "text", required: o.required === true });
  }
  return out.slice(0, 5);
}

/** Gast-Eingaben dürfen keine Platzhalter auslösen, wenn sie in Vorlagentexte einfließen. */
export function neutralizePlaceholders(s: string): string {
  return s.replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }");
}
