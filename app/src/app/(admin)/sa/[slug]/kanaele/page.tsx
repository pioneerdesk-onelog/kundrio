import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { platformInfo, supportsApi } from "@/lib/channels/config";
import { openCredentials } from "@/lib/channels/crypto";
import { REAUTH_PREFIX } from "@/lib/channels/sync";
import { PLATFORM_LABELS, type Platform, type PostMetrics } from "@/lib/channels/types";
import { Badge, Card, Empty, PageHeader, btnCls } from "@/components/ui";
import { SubmitButton } from "@/components/c/SubmitButton";
import { ChannelChart } from "@/components/channels/ChannelChart";
import { PlatformSetup } from "@/components/channels/PlatformSetup";
import { ImportForm } from "@/components/channels/ImportForm";
import { AddChannelForm, MetricForm, SelectAccountForm, SyncButton } from "./forms";
import { deleteChannel, deleteMetric, disconnectChannel } from "./actions";

export const dynamic = "force-dynamic";

const fmt = (n: number | null | undefined) => (n == null ? "–" : new Intl.NumberFormat("de-DE").format(n));
const CONNECTION_LABEL: Record<string, string> = { manual: "manuell", api: "Schnittstelle", import: "Import" };

function postScore(m: PostMetrics) {
  return (m.impressions ?? m.views ?? 0) + 10 * ((m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0));
}

export default async function KanaelePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; fehler?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const mayEdit = can(access, "analytics", "edit");
  const mayDelete = can(access, "analytics", "delete");
  const mayConnect = hasSpecial(access, "manage_keys");
  const channels = await db.channelAccount.findMany({
    where: { workspaceId: ws.id },
    orderBy: [{ platform: "asc" }, { handle: "asc" }],
    include: { metrics: { orderBy: { date: "desc" }, take: 90 }, posts: { orderBy: { publishedAt: "desc" }, take: 50 } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Kanäle" description="Eigene Social-Media-Kanäle lesend auswerten: per Schnittstelle, Export-Import oder manuell. Es werden nur aggregierte Kennzahlen gespeichert – keine Kommentare oder Follower-Listen." />
      {sp.ok && <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-500/10 dark:text-green-300">{sp.ok}</p>}
      {sp.fehler && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">{sp.fehler}</p>}

      {mayEdit && (
        <Card title="Kanal hinzufügen">
          <AddChannelForm slug={slug} />
        </Card>
      )}

      {channels.length === 0 && <Empty>Noch keine Kanäle angelegt.</Empty>}

      {channels.map((c) => {
        const platform = c.platform as Platform;
        const info = platformInfo(platform);
        const api = supportsApi(platform);
        const creds = mayConnect ? openCredentials(c.credentials) : null;
        const candidates = ((creds?.extra?.candidates as { id: string; name: string }[] | undefined) ?? []).slice(0, 50);
        const connected = Boolean(c.credentials) || (info.mode === "key" && c.connection === "api");
        const needsReauth = c.lastError?.startsWith(REAUTH_PREFIX) ?? false;
        const [latest, prev] = c.metrics;
        const delta = latest?.followers != null && prev?.followers != null ? latest.followers - prev.followers : null;
        const chartPoints = [...c.metrics].reverse();
        const top = [...c.posts].sort((a, b) => postScore(b.metrics as PostMetrics) - postScore(a.metrics as PostMetrics)).slice(0, 5);
        const tokenSoon = c.tokenExpiresAt && c.tokenExpiresAt.getTime() - Date.now() < 7 * 864e5;
        return (
          <Card
            key={c.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{PLATFORM_LABELS[platform] ?? c.platform}</Badge>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{c.handle}</a>
                ) : (
                  c.handle
                )}
                <Badge tone={needsReauth ? "bad" : c.connection === "api" ? "ok" : "neutral"}>{needsReauth ? "neu verbinden" : CONNECTION_LABEL[c.connection] ?? c.connection}</Badge>
                {c.lastSyncAt && <span className="text-xs font-normal text-ink-400 dark:text-ink-200">abgerufen {formatDate(c.lastSyncAt, true)}</span>}
              </span>
            }
          >
            <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-ink-400 dark:text-ink-200">Follower</div>
                <div className="font-medium tabular-nums">
                  {fmt(latest?.followers)}
                  {delta != null && delta !== 0 && <span className={`ml-1 text-xs ${delta > 0 ? "text-green-700" : "text-red-600"}`}>{delta > 0 ? "+" : ""}{fmt(delta)}</span>}
                </div>
              </div>
              <div><div className="text-ink-400 dark:text-ink-200">Aufrufe/Reichweite</div><div className="font-medium tabular-nums">{fmt(latest?.views)}</div></div>
              <div><div className="text-ink-400 dark:text-ink-200">Beiträge</div><div className="font-medium tabular-nums">{fmt(latest?.posts)}</div></div>
            </div>

            {c.lastError && <p role="alert" className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{c.lastError}</p>}
            {tokenSoon && !needsReauth && <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">Zugang läuft am {formatDate(c.tokenExpiresAt)} ab{info.platform === "linkedin" ? " – LinkedIn erlaubt danach nur neues Verbinden" : ""}.</p>}

            <div className="mb-3 flex flex-wrap gap-6">
              <ChannelChart title="Follower" points={chartPoints.map((m) => ({ date: m.date, value: m.followers }))} />
              <ChannelChart title="Aufrufe/Reichweite" points={chartPoints.map((m) => ({ date: m.date, value: m.views }))} />
            </div>

            <div className="space-y-3">
              {api && info.configured && (
                <div className="flex flex-wrap items-center gap-2">
                  {info.mode === "oauth" && mayConnect && (
                    <a className={btnCls} href={`/api/channels/oauth/${platform}/start?slug=${encodeURIComponent(slug)}&account=${encodeURIComponent(c.id)}`}>
                      {connected ? "Neu verbinden" : "Verbinden"}
                    </a>
                  )}
                  {mayEdit && (connected || info.mode === "key") && <SyncButton slug={slug} id={c.id} />}
                  {mayConnect && c.credentials && (
                    <form action={disconnectChannel.bind(null, slug, c.id)}>
                      <SubmitButton ghost pending="…" confirm="Verbindung trennen? Gespeicherte Kennzahlen bleiben erhalten. Den Zugriff der App bitte zusätzlich bei der Plattform entziehen.">Trennen</SubmitButton>
                    </form>
                  )}
                </div>
              )}
              {mayConnect && candidates.length > 1 && <SelectAccountForm slug={slug} id={c.id} candidates={candidates} current={c.externalId} />}
              {(!api || !info.configured || info.limits.length > 0) && <PlatformSetup info={info} />}

              {top.length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Top-Beiträge</h3>
                  <table className="w-full text-xs">
                    <thead className="text-left text-ink-400 dark:text-ink-200">
                      <tr><th className="py-1">Beitrag</th><th>Datum</th><th>Impr./Aufrufe</th><th>Likes</th><th>Kommentare</th><th>Geteilt</th></tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {top.map((p) => {
                        const m = p.metrics as PostMetrics;
                        return (
                          <tr key={p.id} className="border-t border-black/5 dark:border-white/5">
                            <td className="max-w-xs truncate py-1">
                              {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{p.title ?? p.externalId}</a> : p.title ?? p.externalId}
                            </td>
                            <td>{formatDate(p.publishedAt)}</td>
                            <td>{fmt(m.impressions ?? m.views)}</td>
                            <td>{fmt(m.likes)}</td>
                            <td>{fmt(m.comments)}</td>
                            <td>{fmt(m.shares)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {mayEdit && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">Kennzahlen manuell eintragen</summary>
                  <div className="mt-2"><MetricForm slug={slug} id={c.id} /></div>
                </details>
              )}
              {mayEdit && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">Export importieren (CSV)</summary>
                  <p className="mt-1 text-xs text-ink-400 dark:text-ink-200">
                    Z. B. LinkedIn-Seitenanalyse (Follower/Updates), Meta Business Suite oder X Analytics. Excel-Dateien bitte als „CSV UTF-8“ speichern.
                  </p>
                  <div className="mt-2"><ImportForm slug={slug} accountId={c.id} /></div>
                </details>
              )}

              {c.metrics.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">Verlauf ({c.metrics.length} Tage)</summary>
                  <table className="mt-2 w-full text-xs">
                    <thead className="text-left text-ink-400 dark:text-ink-200">
                      <tr><th className="py-1">Datum</th><th>Follower</th><th>Aufrufe</th><th>Beiträge</th><th>Quelle</th><th /></tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {c.metrics.slice(0, 30).map((m) => (
                        <tr key={m.id} className="border-t border-black/5 dark:border-white/5">
                          <td className="py-1">{formatDate(m.date)}</td>
                          <td>{fmt(m.followers)}</td>
                          <td>{fmt(m.views)}</td>
                          <td>{fmt(m.posts)}</td>
                          <td className="text-ink-400 dark:text-ink-200">{(m.extra as { source?: string } | null)?.source ?? ""}</td>
                          <td className="text-right">
                            {mayDelete && (
                              <form action={deleteMetric.bind(null, slug, c.id, m.id)}>
                                <button type="submit" className="text-ink-400 hover:text-red-600" aria-label={`Eintrag vom ${formatDate(m.date)} löschen`}>✕</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}

              {mayDelete && (
                <form action={deleteChannel.bind(null, slug, c.id)}>
                  <SubmitButton ghost pending="…" confirm={`Kanal „${c.handle}“ mit allen Kennzahlen und Beiträgen löschen?`}>Kanal löschen</SubmitButton>
                </form>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
