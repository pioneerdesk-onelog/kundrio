import Link from "next/link";
import type { Range } from "@/lib/analytics/stats";
import { btnGhostCls, inputCls } from "@/components/ui";

/** Zeitraum-Auswahl (Links + freier Zeitraum per GET-Formular, ohne JavaScript). */
export function RangeFilter({ basePath, range, active }: { basePath: string; range: Range; active?: string }) {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <nav aria-label="Zeitraum" className="flex gap-1">
        {[7, 30, 90, 365].map((t) => (
          <Link
            key={t}
            href={`${basePath}?t=${t}`}
            aria-current={active === String(t) ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm ${active === String(t) ? "bg-accent-500 text-white" : "hover:bg-sand-100 dark:hover:bg-white/10"}`}
          >
            {t === 365 ? "1 Jahr" : `${t} Tage`}
          </Link>
        ))}
      </nav>
      <form method="get" action={basePath} className="flex items-end gap-2">
        <label className="text-sm">
          <span className="sr-only">Von</span>
          <input type="date" name="von" defaultValue={iso(range.from)} className={`${inputCls} w-40`} />
        </label>
        <label className="text-sm">
          <span className="sr-only">Bis</span>
          <input type="date" name="bis" defaultValue={iso(range.to)} className={`${inputCls} w-40`} />
        </label>
        <button className={btnGhostCls}>Anzeigen</button>
      </form>
    </div>
  );
}
