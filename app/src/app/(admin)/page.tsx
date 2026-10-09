import Link from "next/link";
import { plural } from "@/lib/a-format";
import { ArrowRight, Bot, FileText, ListChecks, Sparkles, Users } from "lucide-react";
import { db } from "@/lib/db";
import { formatEuro, listWorkspaces } from "@/lib/workspace";
import { requireUser } from "@/lib/auth";
import { getAccess, scopeWhere, type Access, type ObjectKey } from "@/lib/permissions";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const AI_BOTS = ["ai_training", "ai_search", "ai_user"];

// Agentur-Übersicht: alle Sub-Accounts auf einen Blick – Vertrieb, Sichtbarkeit (inkl. KI), Pflichten.
export default async function AgencyOverview() {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const now = new Date();
  const [user, workspaces] = await Promise.all([requireUser(), listWorkspaces()]);
  // Rechte je Sub-Account: Kennzahlen zählen nur, was der Benutzer dort sehen darf (inkl. Reichweite eigene/Team)
  const accesses = new Map<string, Access>();
  for (const w of workspaces) {
    const a = await getAccess(user.id, w.id);
    if (a) accesses.set(w.id, a);
  }
  const scopedIn = (object: ObjectKey) => {
    const parts = [...accesses].map(([wsId, a]) => ({ AND: [{ workspaceId: wsId }, scopeWhere(a, object)] }));
    // Typ bewusst neutral: das Fragment passt in jede where-Bedingung mit workspaceId/ownerId
    return (parts.length ? { OR: parts } : { id: { in: [] as string[] } }) as unknown as Record<string, never>;
  };
  const sees = (wsId: string, object: ObjectKey) => accesses.get(wsId)?.perms.objects[object].read !== "none" && accesses.has(wsId);

  const [contacts, newContacts, openDeals, wonDeals, tasksDue, mails, pageviews, aiBots, aiHumans, conversions, pages, openDuties, channels] =
    await Promise.all([
      db.contact.groupBy({ by: ["workspaceId"], where: { ...scopedIn("contacts") }, _count: true }),
      db.contact.groupBy({ by: ["workspaceId"], where: { ...scopedIn("contacts"), createdAt: { gte: since } }, _count: true }),
      db.deal.groupBy({ by: ["workspaceId"], where: { ...scopedIn("deals"), stage: { kind: "OPEN" } }, _sum: { valueCents: true }, _count: true }),
      db.deal.groupBy({ by: ["workspaceId"], where: { ...scopedIn("deals"), stage: { kind: "WON" }, closedAt: { gte: since } }, _sum: { valueCents: true } }),
      db.task.groupBy({ by: ["workspaceId"], where: { ...scopedIn("tasks"), doneAt: null, dueAt: { lte: now } }, _count: true }),
      db.emailMessage.groupBy({ by: ["workspaceId"], where: { ...scopedIn("email"), direction: "OUT", createdAt: { gte: since } }, _count: true }),
      db.analyticsEvent.groupBy({ by: ["workspaceId"], where: { ...scopedIn("analytics"), kind: "pageview", ts: { gte: since } }, _count: true }),
      db.analyticsEvent.groupBy({ by: ["workspaceId"], where: { ...scopedIn("analytics"), kind: "bot", botCategory: { in: AI_BOTS }, ts: { gte: since } }, _count: true }),
      db.analyticsEvent.groupBy({ by: ["workspaceId"], where: { ...scopedIn("analytics"), kind: "pageview", aiReferrer: { not: null }, ts: { gte: since } }, _count: true }),
      db.analyticsEvent.groupBy({ by: ["workspaceId"], where: { ...scopedIn("analytics"), kind: "conversion", ts: { gte: since } }, _count: true }),
      db.landingPage.groupBy({ by: ["workspaceId"], where: { ...scopedIn("pages"), status: "PUBLISHED" }, _count: true }),
      db.complianceItem.groupBy({ by: ["workspaceId"], where: { ...scopedIn("compliance"), status: { in: ["OPEN", "IN_PROGRESS"] } }, _count: true }),
      db.channelAccount.findMany({
        where: { ...scopedIn("analytics"), platform: { not: "website" } },
        include: { metrics: { orderBy: { date: "desc" }, take: 1 } },
      }),
    ]);

  const agencyName = (await db.agency.findFirst({ select: { name: true } }))?.name ?? "Agentur";
  const n = (rows: { workspaceId: string; _count: number }[], id: string) => rows.find((r) => r.workspaceId === id)?._count ?? 0;
  const cents = (rows: { workspaceId: string; _sum: { valueCents: number | null } }[], id: string) =>
    rows.find((r) => r.workspaceId === id)?._sum.valueCents ?? 0;
  const total = (rows: { _count: number }[]) => rows.reduce((a, r) => a + r._count, 0);
  const totalCents = (rows: { _sum: { valueCents: number | null } }[]) => rows.reduce((a, r) => a + (r._sum.valueCents ?? 0), 0);

  return (
    <div>
      <PageHeader title="Agentur-Übersicht" description={`${agencyName} · alle Projekte der letzten 30 Tage: Vertrieb, Sichtbarkeit bei Menschen und KI, offene Pflichten.`} />

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-400">Vertrieb</h2>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Kontakte" value={total(contacts)} hint={`+${total(newContacts).toLocaleString("de-DE")} neu`} />
        <Stat label="Offene Pipeline" value={formatEuro(totalCents(openDeals))} hint={plural(total(openDeals), "Deal", "Deals")} />
        <Stat label="Gewonnen" value={formatEuro(totalCents(wonDeals))} />
        <Stat label="Überfällige Aufgaben" value={total(tasksDue)} />
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-400">Sichtbarkeit</h2>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Seitenaufrufe (Menschen)" value={total(pageviews)} />
        <Stat label="Besuche von KI-Bots" value={total(aiBots)} hint="Training, KI-Suche, Assistenten" />
        <Stat label="Besucher aus KI-Antworten" value={total(aiHumans)} hint="ChatGPT, Perplexity, Claude …" />
        <Stat label="Conversions" value={total(conversions)} hint={`${total(mails).toLocaleString("de-DE")} E-Mails versendet`} />
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-400">Projekte</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {workspaces.map((w) => {
          const duties = n(openDuties, w.id);
          const wsChannels = channels.filter((c) => c.workspaceId === w.id);
          return (
            <Card key={w.id}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <Link href={`/sa/${w.slug}`} className="group flex items-center gap-2.5">
                  <span className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10" style={{ background: w.brandPrimary }} aria-hidden />
                  <span className="font-display text-xl text-ink-900 group-hover:underline dark:text-ink-50">{w.name}</span>
                  <span className="text-sm text-ink-400">{w.domain}</span>
                </Link>
                <Badge tone="neutral">{w.region}</Badge>
              </div>

              <dl className="grid grid-cols-2 gap-4 text-[15px] sm:grid-cols-3">
                {sees(w.id, "contacts") && <Metric icon={<Users size={15} />} label="Kontakte" value={n(contacts, w.id)} href={`/sa/${w.slug}/kontakte`} />}
                {sees(w.id, "deals") && <Metric label="Pipeline" value={formatEuro(cents(openDeals, w.id))} href={`/sa/${w.slug}/pipeline`} />}
                {sees(w.id, "tasks") && <Metric label="Fällig" value={n(tasksDue, w.id)} href={`/sa/${w.slug}/aufgaben`} warn={n(tasksDue, w.id) > 0} />}
                {sees(w.id, "analytics") && <Metric label="Aufrufe" value={n(pageviews, w.id)} href={`/sa/${w.slug}/analytics`} />}
                {sees(w.id, "analytics") && <Metric icon={<Bot size={15} />} label="KI-Bots" value={n(aiBots, w.id)} href={`/sa/${w.slug}/analytics`} />}
                {sees(w.id, "analytics") && <Metric icon={<Sparkles size={15} />} label="aus KI" value={n(aiHumans, w.id)} href={`/sa/${w.slug}/analytics`} />}
                {sees(w.id, "analytics") && <Metric label="Conversions" value={n(conversions, w.id)} href={`/sa/${w.slug}/analytics`} />}
                {sees(w.id, "pages") && <Metric icon={<FileText size={15} />} label="Seiten live" value={n(pages, w.id)} href={`/sa/${w.slug}/seiten`} />}
                {sees(w.id, "compliance") && <Metric icon={<ListChecks size={15} />} label="Pflichten offen" value={duties} href={`/sa/${w.slug}/pflichten`} warn={duties > 0} />}
              </dl>

              {wsChannels.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {wsChannels.map((c) => (
                    <Badge key={c.id} tone="accent">
                      {c.platform}: {c.handle}
                      {c.metrics[0]?.followers != null && ` · ${c.metrics[0].followers.toLocaleString("de-DE")}`}
                    </Badge>
                  ))}
                </div>
              )}

              <Link href={`/sa/${w.slug}`} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent-500 hover:underline dark:text-accent-100">
                Zum Sub-Account <ArrowRight size={14} aria-hidden />
              </Link>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, href, icon, warn }: { label: string; value: React.ReactNode; href: string; icon?: React.ReactNode; warn?: boolean }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-sm text-ink-400 dark:text-ink-200">
        {icon && <span aria-hidden>{icon}</span>}
        {label}
      </dt>
      <dd>
        <Link href={href} className={`font-semibold tabular-nums hover:underline ${warn ? "text-amber-700 dark:text-amber-300" : "text-ink-900 dark:text-ink-50"}`}>
          {typeof value === "number" ? value.toLocaleString("de-DE") : value}
        </Link>
      </dd>
    </div>
  );
}
