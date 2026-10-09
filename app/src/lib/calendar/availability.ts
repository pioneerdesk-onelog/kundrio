// Terminvorschläge aus Frei/Belegt: freie Zeitfenster in Arbeitszeiten (Mo–Fr, Europe/Berlin).

import { TIME_ZONE } from "./config";
import { zonedLocalToUtc, utcToZonedLocal } from "./time";

export type Busy = { start: Date; end: Date };

export type SlotOptions = {
  from: Date;
  days: number;
  durationMin: number;
  bufferMin?: number;
  stepMin?: number;
  workStart?: string; // "09:00"
  workEnd?: string; // "17:00"
  max?: number;
  tz?: string;
};

export function suggestSlots(busy: Busy[], o: SlotOptions): { start: Date; end: Date }[] {
  const tz = o.tz ?? TIME_ZONE;
  const step = (o.stepMin ?? 30) * 60000;
  const dur = o.durationMin * 60000;
  const buf = (o.bufferMin ?? 0) * 60000;
  const out: { start: Date; end: Date }[] = [];
  const startDay = utcToZonedLocal(o.from, tz).slice(0, 10);
  const [y, m, d] = startDay.split("-").map(Number);
  for (let i = 0; i < o.days && out.length < (o.max ?? 8); i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    const wd = day.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const ds = day.toISOString().slice(0, 10);
    const ws = zonedLocalToUtc(`${ds}T${o.workStart ?? "09:00"}`, tz);
    const we = zonedLocalToUtc(`${ds}T${o.workEnd ?? "17:00"}`, tz);
    if (!ws || !we) continue;
    for (let t = ws.getTime(); t + dur <= we.getTime() && out.length < (o.max ?? 8); t += step) {
      if (t < o.from.getTime()) continue;
      const s = t - buf;
      const e = t + dur + buf;
      if (busy.some((b) => b.start.getTime() < e && b.end.getTime() > s)) continue;
      out.push({ start: new Date(t), end: new Date(t + dur) });
    }
  }
  return out;
}
