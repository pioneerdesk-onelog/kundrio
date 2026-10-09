/** "now+24h" / "now-3d" → Datum; sonst ISO-Datum. */
export function resolveDate(v: unknown, now = new Date()): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const m = String(v).trim().match(/^now(?:([+-])(\d{1,5})([hd]))?$/i);
  if (m) {
    if (!m[1]) return now;
    const ms = Number(m[2]) * (m[3].toLowerCase() === "h" ? 3600e3 : 864e5);
    return new Date(now.getTime() + (m[1] === "-" ? -ms : ms));
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Datum + N Werktage (Mo–Fr), 9:00 Uhr Berliner Zeit als frühester Zeitpunkt. */
export function addWorkdays(from: Date, n: number): Date {
  const d = new Date(from);
  let left = Math.max(0, Math.floor(n));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  if (n > 0) d.setUTCHours(7, 0, 0, 0); // ≈ 9:00 Berliner Zeit (Sommerzeit), Vorschlag wird ohnehin geprüft
  return d;
}
