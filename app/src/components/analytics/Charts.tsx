// Schlichte, barrierearme Diagramme ohne Bibliothek: SVG/CSS + Tabellen-Alternative.
import type { ReactNode } from "react";
import { formatDay } from "@/lib/a-format";

const fmt = (v: number) => new Intl.NumberFormat("de-DE").format(v);

type Series = { key: string; label: string; className: string };

/** Tagesbalken für eine oder zwei Reihen (zweite Reihe überlagert, z. B. Besucher über Aufrufen). */
export function DailyBars({
  data,
  series,
  title,
}: {
  data: ({ date: string } & Record<string, number | string>)[];
  series: Series[];
  title: string;
}) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const w = 100 / Math.max(1, data.length);
  const total = (k: string) => data.reduce((a, d) => a + (Number(d[k]) || 0), 0);
  const summary = series.map((s) => `${s.label}: ${fmt(total(s.key))}`).join(", ");
  return (
    <figure>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={`${title}. ${summary}`}>
        {data.map((d, i) =>
          series.map((s, si) => {
            const v = Number(d[s.key]) || 0;
            const h = (v / max) * 38;
            const inset = si === 0 ? 0.12 : 0.3;
            return (
              <rect key={`${d.date}-${s.key}`} x={i * w + w * inset} y={40 - h} width={Math.max(0.2, w * (1 - 2 * inset))} height={h} className={s.className}>
                <title>{`${formatDay(d.date)}: ${s.label} ${fmt(v)}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-4 text-sm text-ink-600 dark:text-ink-200">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <svg width="12" height="12" aria-hidden><rect width="12" height="12" rx="2" className={s.className} /></svg>
            {s.label} ({fmt(total(s.key))})
          </span>
        ))}
        <span className="text-ink-400">{data[0] ? formatDay(data[0].date) : ""} – {formatDay(data.at(-1)?.date ?? "")}</span>
      </figcaption>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-600 dark:text-ink-200">Werte als Tabelle</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left tabular-nums">
            <thead><tr><th className="py-1 pr-4 font-medium">Tag</th>{series.map((s) => <th key={s.key} className="py-1 pr-4 font-medium">{s.label}</th>)}</tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t border-ink-100 dark:border-white/10">
                  <td className="py-1 pr-4">{formatDay(d.date)}</td>
                  {series.map((s) => <td key={s.key} className="py-1 pr-4">{fmt(Number(d[s.key]) || 0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Horizontale Balkenliste (Anteile) – zugleich Tabelle, daher ohne Extra-Alternative barrierearm. */
export function BarList({ rows, valueLabel, empty = "Keine Daten im Zeitraum." }: { rows: { label: ReactNode; value: number; sub?: ReactNode }[]; valueLabel: string; empty?: string }) {
  if (rows.length === 0) return <p className="py-4 text-ink-400 dark:text-ink-200">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <table className="w-full text-[15px]">
      <thead className="sr-only"><tr><th>Eintrag</th><th>{valueLabel}</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="relative py-1 pr-3">
              <div className="absolute inset-y-0.5 left-0 rounded bg-accent-50 dark:bg-accent-500/20" style={{ width: `${(r.value / max) * 100}%` }} aria-hidden />
              <div className="relative truncate px-2 py-0.5">
                {r.label}
                {r.sub && <span className="ml-2 text-sm text-ink-400 dark:text-ink-200">{r.sub}</span>}
              </div>
            </td>
            <td className="w-20 py-1 text-right tabular-nums">{fmt(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
