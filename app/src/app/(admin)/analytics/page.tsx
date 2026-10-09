import Link from "next/link";
import { listWorkspaces } from "@/lib/workspace";
import { requireUser } from "@/lib/auth";
import { getAccess, can } from "@/lib/permissions";
import { getStats, parseRange } from "@/lib/analytics/stats";
import { AnalyticsReport } from "@/components/analytics/Report";
import { RangeFilter } from "@/components/analytics/RangeFilter";
import { Card, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const fmt = (v: number) => new Intl.NumberFormat("de-DE").format(v);

// Agentur-Rollup: alle Sub-Accounts, die der Benutzer sehen darf.
export default async function AgencyAnalytics({ searchParams }: { searchParams: Promise<{ t?: string; von?: string; bis?: string }> }) {
  const sp = await searchParams;
  const range = parseRange(sp);
  const [user, all] = await Promise.all([requireUser(), listWorkspaces()]);
  // Nur Sub-Accounts, in denen Analytics gelesen werden darf
  const workspaces = [];
  for (const w of all) {
    const a = await getAccess(user.id, w.id);
    if (a && can(a, "analytics", "read")) workspaces.push(w);
  }
  const stats = await getStats(workspaces.map((w) => w.id), range);
  const th = "py-1.5 pr-4 text-left text-sm font-medium text-ink-600 dark:text-ink-200";
  const td = "py-1.5 pr-4 tabular-nums";

  return (
    <div>
      <PageHeader title="Analytics – alle Projekte" description="Besucher, Conversions und KI-Sichtbarkeit über alle Sub-Accounts." />
      <div className="mb-6">
        <RangeFilter basePath="/analytics" range={range} active={sp.von ? undefined : String(range.days)} />
      </div>

      <Card title="Nach Sub-Account" className="mb-6">
        {workspaces.length === 0 ? <Empty>Keine Sub-Accounts.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr><th className={th}>Sub-Account</th><th className={th}>Besucher</th><th className={th}>Aufrufe</th><th className={th}>Conversions</th><th className={th}>Aus KI-Antworten</th><th className={th}>KI-Bot-Zugriffe</th></tr>
              </thead>
              <tbody>
                {workspaces.map((w) => {
                  const r = stats.perWorkspace.get(w.id);
                  return (
                    <tr key={w.id} className="border-t border-ink-100 dark:border-white/10">
                      <td className="py-1.5 pr-4">
                        <Link href={`/sa/${w.slug}/analytics?t=${range.days}`} className="inline-flex items-center gap-2 hover:underline">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: w.brandPrimary }} aria-hidden />
                          {w.name}
                        </Link>
                      </td>
                      <td className={td}>{fmt(r?.visitors ?? 0)}</td>
                      <td className={td}>{fmt(r?.pageviews ?? 0)}</td>
                      <td className={td}>{fmt(r?.conversions ?? 0)}</td>
                      <td className={td}>{fmt(r?.aiReferrals ?? 0)}</td>
                      <td className={td}>{fmt(r?.aiBots ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AnalyticsReport stats={stats} range={range} />
    </div>
  );
}
