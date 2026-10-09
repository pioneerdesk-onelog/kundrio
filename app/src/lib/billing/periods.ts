// Reine Datums- und Fristenrechnung für Abos (UTC-Datumswerte ohne Uhrzeit, wie @db.Date).
// Monatsenden: Ankertag wird beibehalten (31.01. → 28./29.02. → 31.03.), nicht „abgeschliffen“.

export const INTERVALS = ["one_time", "monthly", "quarterly", "yearly"] as const;
export type Interval = (typeof INTERVALS)[number];
export const INTERVAL_LABEL: Record<Interval, string> = { one_time: "einmalig", monthly: "monatlich", quarterly: "vierteljährlich", yearly: "jährlich" };
export const INTERVAL_MONTHS: Record<Interval, number> = { one_time: 0, monthly: 1, quarterly: 3, yearly: 12 };
export const isInterval = (v: unknown): v is Interval => typeof v === "string" && (INTERVALS as readonly string[]).includes(v);

/** Datum ohne Uhrzeit (UTC). */
export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function parseDay(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function isoDay(d: Date): string {
  return dateOnly(d).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month0: number) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Monate addieren mit Ankertag (z. B. 31 → letzter Tag des Monats, wenn kürzer). */
export function addMonthsAnchored(date: Date, months: number, anchorDay = date.getUTCDate()): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  return new Date(Date.UTC(ty, tm, Math.min(anchorDay, daysInMonth(ty, tm))));
}

export function addDays(date: Date, days: number): Date {
  const d = dateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Abrechnungsperiode, die am `periodStart` beginnt: [start, end] (end = Tag vor der nächsten Periode).
 * Ankertag ist der Tag des Abo-Starts, damit Monatsenden stabil bleiben.
 */
export function billingPeriod(periodStart: Date, interval: Interval, anchorDay: number): { from: Date; to: Date; next: Date } {
  const from = dateOnly(periodStart);
  if (interval === "one_time") return { from, to: from, next: from };
  const next = addMonthsAnchored(from, INTERVAL_MONTHS[interval], anchorDay);
  return { from, to: addDays(next, -1), next };
}

/** Alle fälligen Perioden bis einschließlich `today` (Nachholung nach Ausfall, max. `limit`). */
export function duePeriods(nextBillingDate: Date, interval: Interval, anchorDay: number, today: Date, limit = 24) {
  const out: { from: Date; to: Date; next: Date }[] = [];
  let cur = dateOnly(nextBillingDate);
  const t = dateOnly(today);
  while (cur <= t && out.length < limit) {
    const p = billingPeriod(cur, interval, anchorDay);
    out.push(p);
    if (interval === "one_time") break;
    cur = p.next;
  }
  return out;
}

/**
 * Wirksamkeit einer Kündigung.
 * B2B: Kündigung zum Ende der laufenden Abrechnungsperiode bzw. Mindestlaufzeit, mit Kündigungsfrist (Tage) davor;
 *      reicht die Frist nicht, verschiebt sich das Ende um jeweils eine Periode.
 * B2C (§ 309 Nr. 9 BGB): nach Ablauf der Mindestlaufzeit jederzeit mit höchstens einem Monat Frist kündbar;
 *      vor Ablauf zum Ende der Mindestlaufzeit, Frist höchstens ein Monat.
 */
export function cancellationEffectiveDate(input: {
  startDate: Date;
  interval: Interval;
  minTermMonths: number;
  noticePeriodDays: number;
  consumer: boolean;
  requestedAt: Date;
  nextBillingDate: Date;
}): Date {
  const req = dateOnly(input.requestedAt);
  const anchor = input.startDate.getUTCDate();
  const minEnd = input.minTermMonths > 0 ? addDays(addMonthsAnchored(input.startDate, input.minTermMonths, anchor), -1) : null;

  if (input.consumer) {
    // höchstens ein Monat Frist; nach der Mindestlaufzeit verlängert sich der Vertrag nur unbefristet und ist jederzeit kündbar
    const earliest = addDays(req, Math.min(input.noticePeriodDays, 30));
    if (minEnd && earliest <= minEnd) return minEnd;
    return earliest;
  }

  if (input.interval === "one_time") return req;
  // Ende der laufenden Periode = Tag vor nextBillingDate; mindestens Mindestlaufzeit
  let end = addDays(input.nextBillingDate, -1);
  if (minEnd && end < minEnd) end = minEnd;
  let guard = 0;
  while (addDays(end, -input.noticePeriodDays) < req && guard++ < 120) {
    end = addDays(addMonthsAnchored(addDays(end, 1), INTERVAL_MONTHS[input.interval], anchor), -1);
  }
  return end;
}

/** Monatlich wiederkehrender Umsatz eines Abos (Netto, Cent). */
export function monthlyRecurringCents(items: { qty: number; unitCents: number }[], interval: Interval): number {
  if (interval === "one_time") return 0;
  const sum = items.reduce((s, i) => s + Math.round(i.qty * i.unitCents), 0);
  return Math.round(sum / INTERVAL_MONTHS[interval]);
}
