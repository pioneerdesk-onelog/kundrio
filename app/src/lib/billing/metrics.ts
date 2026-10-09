import { isInterval, monthlyRecurringCents, type Interval } from "./periods";
import { parseItems } from "../invoice";

// Kennzahlen aus Abos (rein): MRR/ARR, Neu, Kündigungen, Churn (Monat).
export type SubLike = { status: string; interval: string; items: unknown; startDate: Date; cancelledAt: Date | null; endDate: Date | null };

export function subscriptionMetrics(subs: SubLike[], now: Date) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Gekündigte Abos laufen bis zum Vertragsende weiter und zählen bis dahin zum MRR
  const activeNow = (s: SubLike) => (s.status === "active" || s.status === "cancelled") && (!s.endDate || s.endDate >= now);
  const mrr = subs.filter(activeNow).reduce((sum, s) => sum + monthlyRecurringCents(parseItems(s.items), (isInterval(s.interval) ? s.interval : "monthly") as Interval), 0);
  const activeAtMonthStart = subs.filter((s) => s.startDate < monthStart && (!s.endDate || s.endDate >= monthStart) && s.status !== "ended").length;
  const newThisMonth = subs.filter((s) => s.startDate >= monthStart).length;
  const cancelledThisMonth = subs.filter((s) => s.cancelledAt && s.cancelledAt >= monthStart).length;
  const churn = activeAtMonthStart ? cancelledThisMonth / activeAtMonthStart : 0;
  return { mrrCents: mrr, arrCents: mrr * 12, active: subs.filter(activeNow).length, newThisMonth, cancelledThisMonth, churn };
}
