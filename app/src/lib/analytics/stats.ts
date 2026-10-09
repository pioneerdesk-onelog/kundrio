import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AI_BOT_CATEGORIES } from "./bots";

// Auswertungen für Dashboard und Agentur-Rollup. Alle Abfragen sind auf workspaceIds begrenzt.

export type Range = { from: Date; to: Date; days: number; label: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

/** Zeitraum aus Suchparametern: t=7|30|90|365 oder von/bis (YYYY-MM-DD), höchstens 400 Tage. */
export function parseRange(sp: { t?: string; von?: string; bis?: string }): Range {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const today = day(iso(new Date()));
  if (sp.von && sp.bis && re.test(sp.von) && re.test(sp.bis)) {
    let from = day(sp.von);
    const to = day(sp.bis);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
      const maxFrom = new Date(to.getTime() - 399 * 86_400_000);
      if (from < maxFrom) from = maxFrom;
      const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
      return { from, to, days, label: `${sp.von} bis ${sp.bis}` };
    }
  }
  const t = [7, 30, 90, 365].includes(Number(sp.t)) ? Number(sp.t) : 30;
  return { from: new Date(today.getTime() - (t - 1) * 86_400_000), to: today, days: t, label: `letzte ${t} Tage` };
}

const n = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0));

// Quelle eines Ereignisses als Schlüssel: ki:<name> | utm:<quelle> | ref:<host> | direkt
const SOURCE = Prisma.sql`CASE
  WHEN "aiReferrer" IS NOT NULL THEN 'ki:' || "aiReferrer"
  WHEN "utmSource" IS NOT NULL THEN 'utm:' || lower("utmSource")
  WHEN "referrerHost" IS NOT NULL THEN 'ref:' || "referrerHost"
  ELSE 'direkt' END`;

const AI_CATS = Prisma.join(AI_BOT_CATEGORIES);

export async function getStats(workspaceIds: string[], range: Range) {
  const where = Prisma.sql`"workspaceId" = ANY(${workspaceIds}::text[]) AND date BETWEEN ${range.from}::date AND ${range.to}::date`;

  const [summaryRows, dailyRows, pages, sources, utm, devices, langs, bots, botPaths, aiRefs, aiRefPaths, revenue, perWs] = await Promise.all([
    db.$queryRaw<Record<string, bigint>[]>`
      SELECT
        count(*) FILTER (WHERE kind = 'pageview') AS pageviews,
        count(DISTINCT (date, "visitorHash")) FILTER (WHERE kind = 'pageview' AND "visitorHash" IS NOT NULL) AS visitors,
        count(*) FILTER (WHERE kind = 'bot') AS bots,
        count(*) FILTER (WHERE kind = 'bot' AND "botCategory" IN (${AI_CATS})) AS ai_bots,
        count(*) FILTER (WHERE kind = 'pageview' AND "aiReferrer" IS NOT NULL) AS ai_referrals,
        count(*) FILTER (WHERE kind = 'conversion') AS conversions,
        count(*) FILTER (WHERE kind = 'event') AS events,
        count(*) FILTER (WHERE kind = 'audit') AS audit
      FROM "AnalyticsEvent" WHERE ${where}`,
    db.$queryRaw<{ date: Date; pageviews: bigint; visitors: bigint; ai_bots: bigint; other_bots: bigint; conversions: bigint }[]>`
      SELECT date,
        count(*) FILTER (WHERE kind = 'pageview') AS pageviews,
        count(DISTINCT "visitorHash") FILTER (WHERE kind = 'pageview') AS visitors,
        count(*) FILTER (WHERE kind = 'bot' AND "botCategory" IN (${AI_CATS})) AS ai_bots,
        count(*) FILTER (WHERE kind = 'bot' AND ("botCategory" IS NULL OR "botCategory" NOT IN (${AI_CATS}))) AS other_bots,
        count(*) FILTER (WHERE kind = 'conversion') AS conversions
      FROM "AnalyticsEvent" WHERE ${where} GROUP BY date ORDER BY date`,
    db.$queryRaw<{ path: string; host: string | null; views: bigint; visitors: bigint }[]>`
      SELECT path, max(host) AS host, count(*) AS views, count(DISTINCT (date, "visitorHash")) AS visitors
      FROM "AnalyticsEvent" WHERE ${where} AND kind = 'pageview'
      GROUP BY path ORDER BY views DESC LIMIT 15`,
    db.$queryRaw<{ source: string; visitors: bigint; views: bigint; conversions: bigint }[]>`
      SELECT ${SOURCE} AS source,
        count(DISTINCT (date, "visitorHash")) FILTER (WHERE kind = 'pageview') AS visitors,
        count(*) FILTER (WHERE kind = 'pageview') AS views,
        count(*) FILTER (WHERE kind = 'conversion') AS conversions
      FROM "AnalyticsEvent" WHERE ${where} AND kind IN ('pageview', 'conversion')
      GROUP BY 1 ORDER BY visitors DESC, conversions DESC LIMIT 20`,
    db.$queryRaw<{ utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; views: bigint; conversions: bigint }[]>`
      SELECT "utmSource", "utmMedium", "utmCampaign",
        count(*) FILTER (WHERE kind = 'pageview') AS views,
        count(*) FILTER (WHERE kind = 'conversion') AS conversions
      FROM "AnalyticsEvent" WHERE ${where} AND kind IN ('pageview', 'conversion')
        AND ("utmSource" IS NOT NULL OR "utmCampaign" IS NOT NULL)
      GROUP BY 1, 2, 3 ORDER BY views DESC LIMIT 15`,
    db.$queryRaw<{ device: string | null; count: bigint }[]>`
      SELECT device, count(*) AS count FROM "AnalyticsEvent" WHERE ${where} AND kind = 'pageview' GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ lang: string | null; count: bigint }[]>`
      SELECT lang, count(*) AS count FROM "AnalyticsEvent" WHERE ${where} AND kind = 'pageview' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    db.$queryRaw<{ category: string | null; name: string | null; hits: bigint; paths: bigint; last: Date }[]>`
      SELECT "botCategory" AS category, "botName" AS name, count(*) AS hits, count(DISTINCT path) AS paths, max(ts) AS last
      FROM "AnalyticsEvent" WHERE ${where} AND kind = 'bot'
      GROUP BY 1, 2 ORDER BY hits DESC LIMIT 40`,
    db.$queryRaw<{ path: string; hits: bigint; bots: string }[]>`
      SELECT path, count(*) AS hits, string_agg(DISTINCT "botName", ', ') AS bots
      FROM "AnalyticsEvent" WHERE ${where} AND kind = 'bot' AND "botCategory" IN (${AI_CATS})
      GROUP BY path ORDER BY hits DESC LIMIT 15`,
    db.$queryRaw<{ ai: string; visits: bigint; conversions: bigint }[]>`
      SELECT "aiReferrer" AS ai,
        count(*) FILTER (WHERE kind = 'pageview') AS visits,
        count(*) FILTER (WHERE kind = 'conversion') AS conversions
      FROM "AnalyticsEvent" WHERE ${where} AND "aiReferrer" IS NOT NULL AND kind IN ('pageview', 'conversion')
      GROUP BY 1 ORDER BY visits DESC`,
    db.$queryRaw<{ path: string; ai: string; visits: bigint }[]>`
      SELECT path, string_agg(DISTINCT "aiReferrer", ', ') AS ai, count(*) AS visits
      FROM "AnalyticsEvent" WHERE ${where} AND kind = 'pageview' AND "aiReferrer" IS NOT NULL
      GROUP BY path ORDER BY visits DESC LIMIT 10`,
    // Erste Conversion je Kontakt bestimmt die Quelle (First-Touch); Umsatz = gewonnene Deals im Zeitraum
    db.$queryRaw<{ source: string; contacts: bigint; deals: bigint; revenue: bigint | null }[]>`
      WITH first_touch AS (
        SELECT DISTINCT ON ("contactId") "contactId", ${SOURCE} AS source
        FROM "AnalyticsEvent"
        WHERE "workspaceId" = ANY(${workspaceIds}::text[]) AND kind = 'conversion' AND "contactId" IS NOT NULL
        ORDER BY "contactId", ts
      )
      SELECT f.source, count(DISTINCT f."contactId") AS contacts, count(DISTINCT d.id) AS deals, sum(d."valueCents") AS revenue
      FROM first_touch f
      JOIN "Deal" d ON d."contactId" = f."contactId"
      JOIN "Stage" s ON s.id = d."stageId" AND s.kind = 'WON'
      WHERE d."closedAt" >= ${range.from} AND d."closedAt" < ${new Date(range.to.getTime() + 86_400_000)}
      GROUP BY f.source ORDER BY revenue DESC NULLS LAST`,
    db.$queryRaw<{ workspaceId: string; pageviews: bigint; visitors: bigint; ai_bots: bigint; ai_referrals: bigint; conversions: bigint }[]>`
      SELECT "workspaceId",
        count(*) FILTER (WHERE kind = 'pageview') AS pageviews,
        count(DISTINCT (date, "visitorHash")) FILTER (WHERE kind = 'pageview' AND "visitorHash" IS NOT NULL) AS visitors,
        count(*) FILTER (WHERE kind = 'bot' AND "botCategory" IN (${AI_CATS})) AS ai_bots,
        count(*) FILTER (WHERE kind = 'pageview' AND "aiReferrer" IS NOT NULL) AS ai_referrals,
        count(*) FILTER (WHERE kind = 'conversion') AS conversions
      FROM "AnalyticsEvent" WHERE ${where} GROUP BY 1`,
  ]);

  const s = summaryRows[0] ?? {};
  const summary = {
    pageviews: n(s.pageviews),
    visitors: n(s.visitors),
    bots: n(s.bots),
    aiBots: n(s.ai_bots),
    aiReferrals: n(s.ai_referrals),
    conversions: n(s.conversions),
    events: n(s.events),
    audit: n(s.audit),
  };

  // Lückenlose Tagesreihe
  const byDate = new Map(dailyRows.map((r) => [iso(r.date), r]));
  const daily = Array.from({ length: range.days }, (_, i) => {
    const key = iso(new Date(range.from.getTime() + i * 86_400_000));
    const r = byDate.get(key);
    return {
      date: key,
      pageviews: n(r?.pageviews),
      visitors: n(r?.visitors),
      aiBots: n(r?.ai_bots),
      otherBots: n(r?.other_bots),
      conversions: n(r?.conversions),
    };
  });

  return {
    summary,
    daily,
    pages: pages.map((r) => ({ path: r.path, host: r.host, views: n(r.views), visitors: n(r.visitors) })),
    sources: sources.map((r) => ({
      source: r.source,
      visitors: n(r.visitors),
      views: n(r.views),
      conversions: n(r.conversions),
      rate: n(r.visitors) > 0 ? n(r.conversions) / n(r.visitors) : null,
    })),
    utm: utm.map((r) => ({ ...r, views: n(r.views), conversions: n(r.conversions) })),
    devices: devices.map((r) => ({ label: r.device ?? "unbekannt", value: n(r.count) })),
    langs: langs.map((r) => ({ label: r.lang ?? "unbekannt", value: n(r.count) })),
    bots: bots.map((r) => ({ category: r.category ?? "other", name: r.name ?? "unbekannt", hits: n(r.hits), paths: n(r.paths), last: r.last })),
    botPaths: botPaths.map((r) => ({ path: r.path, hits: n(r.hits), bots: r.bots })),
    aiRefs: aiRefs.map((r) => ({ ai: r.ai, visits: n(r.visits), conversions: n(r.conversions) })),
    aiRefPaths: aiRefPaths.map((r) => ({ path: r.path, ai: r.ai, visits: n(r.visits) })),
    revenue: revenue.map((r) => ({ source: r.source, contacts: n(r.contacts), deals: n(r.deals), revenueCents: n(r.revenue) })),
    perWorkspace: new Map(
      perWs.map((r) => [
        r.workspaceId,
        { pageviews: n(r.pageviews), visitors: n(r.visitors), aiBots: n(r.ai_bots), aiReferrals: n(r.ai_referrals), conversions: n(r.conversions) },
      ]),
    ),
  };
}

export type Stats = Awaited<ReturnType<typeof getStats>>;
