import { AI_REFERRER_LABEL, BOT_CATEGORY_LABEL, isAiBot, type BotCategory } from "@/lib/analytics/bots";
import type { Range, Stats } from "@/lib/analytics/stats";
import { formatEuro } from "@/lib/workspace";
import { Badge, Card, Empty, Stat } from "@/components/ui";
import { BarList, DailyBars } from "./Charts";

const fmt = (v: number) => new Intl.NumberFormat("de-DE").format(v);
const pct = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(1).replace(".", ",")} %`);

export function sourceLabel(key: string) {
  if (key === "direkt") return "Direkt / unbekannt";
  const [type, ...rest] = key.split(":");
  const v = rest.join(":");
  if (type === "ki") return `KI · ${AI_REFERRER_LABEL[v] ?? v}`;
  if (type === "utm") return `Kampagne · ${v}`;
  return v;
}

const th = "py-1.5 pr-4 text-left text-sm font-medium text-ink-600 dark:text-ink-200";
const td = "py-1.5 pr-4 tabular-nums";

/** Gemeinsamer Bericht für Sub-Account-Dashboard und Agentur-Rollup. */
export function AnalyticsReport({ stats, range }: { stats: Stats; range: Range }) {
  const s = stats.summary;
  const aiBots = stats.bots.filter((b) => isAiBot(b.category));
  const byCategory = Object.entries(
    stats.bots.reduce<Record<string, number>>((acc, b) => ((acc[b.category] = (acc[b.category] ?? 0) + b.hits), acc), {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="Besucher" value={fmt(s.visitors)} hint="je Tag eindeutig" />
        <Stat label="Seitenaufrufe" value={fmt(s.pageviews)} />
        <Stat label="Conversions" value={fmt(s.conversions)} hint={s.visitors ? `${pct(s.conversions / s.visitors)} der Besucher` : undefined} />
        <Stat label="Aus KI-Antworten" value={fmt(s.aiReferrals)} hint="Besuche über ChatGPT & Co." />
        <Stat label="KI-Bot-Zugriffe" value={fmt(s.aiBots)} hint="Training, Suche, Live-Abruf" />
        <Stat label="Andere Bots" value={fmt(s.bots - s.aiBots)} />
      </div>

      <Card title={`Besucher und Seitenaufrufe · ${range.label}`}>
        <DailyBars
          title="Besucher und Seitenaufrufe pro Tag"
          data={stats.daily}
          series={[
            { key: "pageviews", label: "Seitenaufrufe", className: "fill-accent-100 dark:fill-accent-700" },
            { key: "visitors", label: "Besucher", className: "fill-accent-500 dark:fill-accent-300" },
          ]}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Quellen und Conversion-Rate">
          {stats.sources.length === 0 ? <Empty>Keine Besuche im Zeitraum.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead><tr><th className={th}>Quelle</th><th className={th}>Besucher</th><th className={th}>Conv.</th><th className={th}>Rate</th></tr></thead>
                <tbody>
                  {stats.sources.map((r) => (
                    <tr key={r.source} className="border-t border-ink-100 dark:border-white/10">
                      <td className="py-1.5 pr-4">{r.source.startsWith("ki:") ? <Badge tone="accent">{sourceLabel(r.source)}</Badge> : sourceLabel(r.source)}</td>
                      <td className={td}>{fmt(r.visitors)}</td>
                      <td className={td}>{fmt(r.conversions)}</td>
                      <td className={td}>{pct(r.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Top-Seiten">
          <BarList valueLabel="Aufrufe" rows={stats.pages.map((p) => ({ label: p.path, value: p.views, sub: p.host ?? undefined }))} />
        </Card>
      </div>

      <Card title="KI-Bots: wer liest Ihre Inhalte?">
        <p className="mb-4 max-w-prose text-ink-600 dark:text-ink-200">
          KI-Dienste rufen Seiten ab, um Modelle zu trainieren (Training), Antworten mit Quellen zu geben (Suche) oder live für einen Nutzer nachzuschlagen (Live-Abruf).
          Bots führen kein JavaScript aus – sie werden serverseitig bzw. über den Log-Import erfasst.
        </p>
        <DailyBars
          title="Bot-Zugriffe pro Tag"
          data={stats.daily}
          series={[
            { key: "otherBots", label: "Andere Bots", className: "fill-ink-200 dark:fill-ink-600" },
            { key: "aiBots", label: "KI-Bots", className: "fill-amber-500" },
          ]}
        />
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div>
            <h3 className="mb-2 font-medium">Nach Art</h3>
            <BarList valueLabel="Zugriffe" rows={byCategory.map(([c, v]) => ({ label: BOT_CATEGORY_LABEL[c as BotCategory] ?? c, value: v }))} />
          </div>
          <div className="lg:col-span-2">
            <h3 className="mb-2 font-medium">KI-Bots im Einzelnen</h3>
            {aiBots.length === 0 ? <Empty>Noch keine KI-Bots erfasst.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead><tr><th className={th}>Bot</th><th className={th}>Art</th><th className={th}>Zugriffe</th><th className={th}>Seiten</th><th className={th}>Zuletzt</th></tr></thead>
                  <tbody>
                    {aiBots.map((b) => (
                      <tr key={`${b.category}-${b.name}`} className="border-t border-ink-100 dark:border-white/10">
                        <td className="py-1.5 pr-4 font-medium">{b.name}</td>
                        <td className="py-1.5 pr-4">{BOT_CATEGORY_LABEL[b.category as BotCategory] ?? b.category}</td>
                        <td className={td}>{fmt(b.hits)}</td>
                        <td className={td}>{fmt(b.paths)}</td>
                        <td className={td}>{new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(b.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <h3 className="mt-6 mb-2 font-medium">Welche Seiten lesen KI-Bots?</h3>
        <BarList valueLabel="Zugriffe" rows={stats.botPaths.map((p) => ({ label: p.path, value: p.hits, sub: p.bots }))} empty="Noch keine KI-Bot-Zugriffe." />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Besucher aus KI-Antworten">
          {stats.aiRefs.length === 0 ? <Empty>Noch keine Besuche aus ChatGPT, Perplexity & Co.</Empty> : (
            <>
              <table className="w-full text-[15px]">
                <thead><tr><th className={th}>KI-Dienst</th><th className={th}>Besuche</th><th className={th}>Conversions</th></tr></thead>
                <tbody>
                  {stats.aiRefs.map((r) => (
                    <tr key={r.ai} className="border-t border-ink-100 dark:border-white/10">
                      <td className="py-1.5 pr-4">{AI_REFERRER_LABEL[r.ai] ?? r.ai}</td>
                      <td className={td}>{fmt(r.visits)}</td>
                      <td className={td}>{fmt(r.conversions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 className="mt-4 mb-2 font-medium">Einstiegsseiten</h3>
              <BarList valueLabel="Besuche" rows={stats.aiRefPaths.map((p) => ({ label: p.path, value: p.visits, sub: p.ai }))} />
            </>
          )}
        </Card>
        <Card title="Umsatz nach Erstquelle">
          <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">Gewonnene Deals im Zeitraum, zugeordnet zur Quelle der ersten Conversion des Kontakts (ohne Cookies: nur Besuche am selben Tag verknüpfbar).</p>
          {stats.revenue.length === 0 ? <Empty>Noch kein zuordenbarer Umsatz.</Empty> : (
            <table className="w-full text-[15px]">
              <thead><tr><th className={th}>Quelle</th><th className={th}>Kontakte</th><th className={th}>Deals</th><th className={th}>Umsatz</th></tr></thead>
              <tbody>
                {stats.revenue.map((r) => (
                  <tr key={r.source} className="border-t border-ink-100 dark:border-white/10">
                    <td className="py-1.5 pr-4">{sourceLabel(r.source)}</td>
                    <td className={td}>{fmt(r.contacts)}</td>
                    <td className={td}>{fmt(r.deals)}</td>
                    <td className={td}>{formatEuro(r.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Kampagnen (UTM)">
          {stats.utm.length === 0 ? <Empty>Keine UTM-Kampagnen.</Empty> : (
            <table className="w-full text-[15px]">
              <thead><tr><th className={th}>Quelle / Medium / Kampagne</th><th className={th}>Aufrufe</th><th className={th}>Conv.</th></tr></thead>
              <tbody>
                {stats.utm.map((u, i) => (
                  <tr key={i} className="border-t border-ink-100 dark:border-white/10">
                    <td className="py-1.5 pr-4">{[u.utmSource, u.utmMedium, u.utmCampaign].map((v) => v ?? "–").join(" / ")}</td>
                    <td className={td}>{fmt(u.views)}</td>
                    <td className={td}>{fmt(u.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Geräte">
          <BarList valueLabel="Aufrufe" rows={stats.devices.map((d) => ({ label: { desktop: "Desktop", mobile: "Smartphone", tablet: "Tablet" }[d.label] ?? d.label, value: d.value }))} />
        </Card>
        <Card title="Sprachen">
          <BarList valueLabel="Aufrufe" rows={stats.langs.map((d) => ({ label: d.label.toUpperCase(), value: d.value }))} />
        </Card>
      </div>

      {s.audit > 0 && (
        <p className="text-sm text-ink-400 dark:text-ink-200">{fmt(s.audit)} eigene Aufrufe angemeldeter Benutzer wurden erkannt und nicht mitgezählt.</p>
      )}
    </div>
  );
}
