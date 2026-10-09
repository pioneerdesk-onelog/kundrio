// Schlichtes SVG-Liniendiagramm (Follower/Aufrufe) mit Tabellen-Alternative für Screenreader.
type Point = { date: Date; value: number | null };

const fmt = (n: number | null | undefined) => (n == null ? "–" : new Intl.NumberFormat("de-DE").format(n));

export function ChannelChart({ title, points }: { title: string; points: Point[] }) {
  const pts = points.filter((p): p is { date: Date; value: number } => p.value != null).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (pts.length < 2) return null;
  const w = 320;
  const h = 72;
  const min = Math.min(...pts.map((p) => p.value));
  const max = Math.max(...pts.map((p) => p.value));
  const span = max - min || 1;
  const t0 = pts[0].date.getTime();
  const t1 = pts[pts.length - 1].date.getTime();
  const tx = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (w - 4) + 2);
  const ty = (v: number) => h - 4 - ((v - min) / span) * (h - 8);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${tx(p.date.getTime()).toFixed(1)},${ty(p.value).toFixed(1)}`).join(" ");
  const label = `${title}: von ${fmt(pts[0].value)} auf ${fmt(pts[pts.length - 1].value)}`;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-xs text-ink-400 dark:text-ink-200">
        {title} <span className="tabular-nums">({fmt(pts[0].value)} → {fmt(pts[pts.length - 1].value)})</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full max-w-[320px] text-accent-500 dark:text-accent-100" role="img" aria-label={label}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <details className="text-xs">
        <summary className="cursor-pointer text-ink-400 dark:text-ink-200">Werte als Tabelle</summary>
        <table className="mt-1 tabular-nums">
          <tbody>
            {pts.map((p) => (
              <tr key={p.date.toISOString()}>
                <td className="pr-3">{p.date.toLocaleDateString("de-DE")}</td>
                <td>{fmt(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
