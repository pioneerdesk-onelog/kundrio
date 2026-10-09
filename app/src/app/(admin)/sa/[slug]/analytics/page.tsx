import Link from "next/link";
import { pageAccess } from "@/lib/permissions/guard";
import { env } from "@/lib/env";
import { getStats, parseRange } from "@/lib/analytics/stats";
import { ensureRetentionScheduled } from "@/jobs/analytics";
import { AnalyticsReport } from "@/components/analytics/Report";
import { RangeFilter } from "@/components/analytics/RangeFilter";
import { Card, PageHeader, btnGhostCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string; von?: string; bis?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { ws } = await pageAccess(slug);
  const range = parseRange(sp);
  const [stats] = await Promise.all([getStats([ws.id], range), ensureRetentionScheduled().catch(() => {})]);

  const origin = new URL(env.appUrl()).origin;
  const snippet = `<script defer src="${origin}/api/a/script.js?ws=${ws.slug}"></script>`;
  const origins = [ws.domain && `https://${ws.domain}`, ws.domain && `https://www.${ws.domain}`, ...ws.allowedOrigins].filter(Boolean);

  return (
    <div>
      <PageHeader title="Analytics" description="Cookiefrei, ohne IP-Speicherung. Inklusive KI-Bots und Besuchern aus KI-Antworten.">
        <Link href={`/sa/${slug}/analytics/import`} className={btnGhostCls}>Server-Log importieren</Link>
      </PageHeader>
      <div className="mb-6">
        <RangeFilter basePath={`/sa/${slug}/analytics`} range={range} active={sp.von ? undefined : String(range.days)} />
      </div>

      <AnalyticsReport stats={stats} range={range} />

      <Card title="Einbau auf Ihrer Website" className="mt-6">
        <ol className="list-decimal space-y-3 pl-5 text-[15px]">
          <li>
            Dieses Skript in den <code>&lt;head&gt;</code> jeder Seite einfügen (Landingpages aus dem CRM zählen automatisch):
            <pre className="mt-2 overflow-x-auto rounded-md bg-sand-100 p-3 font-mono text-sm dark:bg-white/10">{snippet}</pre>
          </li>
          <li>
            Conversions melden, z. B. nach einer Anmeldung: <code className="font-mono">window.pdTrack(&quot;newsletter&quot;)</code>
          </li>
          <li>
            Erlaubte Websites (CORS): {origins.length ? origins.join(", ") : "noch keine"} – weitere unter{" "}
            <Link className="underline" href={`/sa/${slug}/einstellungen`}>Einstellungen</Link>.
          </li>
          <li>
            KI-Bots führen kein JavaScript aus. Auf externen Websites deshalb regelmäßig das{" "}
            <Link className="underline" href={`/sa/${slug}/analytics/import`}>Server-Log importieren</Link>.
          </li>
          <li>
            Für KI-Sichtbarkeit: KI-Crawler in der <code>robots.txt</code> bewusst erlauben oder sperren (z. B. GPTBot, ClaudeBot, PerplexityBot,
            OAI-SearchBot) und eine <code>llms.txt</code> mit den wichtigsten Seiten bereitstellen. Erfolg zeigt sich oben unter „KI-Bots“ und
            „Besucher aus KI-Antworten“.
          </li>
        </ol>
        <p className="mt-4 text-sm text-ink-400 dark:text-ink-200">
          Datenschutz: keine Cookies, kein localStorage, keine IP-Speicherung. Besucher werden über einen Hash mit täglich neuem Zufallssalz gezählt
          und lassen sich nicht über Tage verfolgen. Rohdaten werden nach 13 Monaten gelöscht. Ob dafür eine Einwilligung nötig ist, bitte
          rechtlich prüfen lassen (nach gängiger Einschätzung nicht).
        </p>
      </Card>
    </div>
  );
}
