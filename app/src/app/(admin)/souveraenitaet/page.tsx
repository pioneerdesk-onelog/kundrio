import Link from "next/link";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { isAgencyStaffUser, requireUser } from "@/lib/auth";
import { NoAccess } from "@/components/users/NoAccess";
import { listWorkspaces, formatNumber } from "@/lib/workspace";
import { externalConnections, regionViolations } from "@/lib/compliance-connections";
import { FRAMEWORK_LABEL, type Framework } from "@/lib/compliance-catalog";
import { Badge, Card, PageHeader, btnGhostCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SovereigntyPage() {
  const [user, workspaces] = await Promise.all([requireUser(), listWorkspaces()]);
  // Agentur-weite Sicht (alle Außenverbindungen, KI-Nutzung, Gesamtexport) nur für Inhaber/Admin der Agentur
  if (!isAgencyStaffUser(user)) return <NoAccess what="das Souveränitäts-Cockpit" scope="agency" />;
  const conns = externalConnections();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const wsIds = workspaces.map((w) => w.id);

  const [aiUsage, compliance, lastExportable] = await Promise.all([
    db.aiUsageLog.groupBy({
      by: ["purpose", "model", "provider"],
      where: { createdAt: { gte: since }, OR: [{ workspaceId: { in: wsIds } }, ...(isAgencyStaffUser(user) ? [{ workspaceId: null }] : [])] },
      _count: true,
      _avg: { ms: true },
      orderBy: { _count: { purpose: "desc" } },
    }),
    db.complianceItem.groupBy({ by: ["workspaceId", "status"], where: { workspaceId: { in: wsIds } }, _count: true }),
    db.workspace.count({ where: { id: { in: wsIds } } }),
  ]);

  const warnings = workspaces.flatMap((w) => regionViolations(conns, w).map((c) => ({ ws: w, c })));
  // Verbindungen, die nur bei eingeschalteter Funktion Daten senden – neutral erklären statt warnen
  const onDemand = conns.filter((c) => c.active && c.outbound && c.onlyWhen && c.regions.length < 2);

  const exitChecks = [
    { ok: lastExportable > 0, text: "Vollständiger Export je Sub-Account verfügbar (JSON + CSV, offene Formate)" },
    { ok: conns.every((c) => !!c.replaceable), text: "Jeder externe Dienst hat einen benannten Ersatz" },
    { ok: !conns.some((c) => c.id === "ollama" && c.outbound), text: "KI-Modelle laufen lokal (kein Abfluss von Inhalten)" },
    { ok: !conns.some((c) => c.id === "smtp" && c.outbound), text: "E-Mail-Versand ohne externen Dienst (capture) – im Live-Betrieb AVV und Standort prüfen" },
    { ok: !conns.some((c) => c.id === "youtube" && c.active), text: "Keine aktive Verbindung zu US-Diensten" },
    { ok: null, text: "Export in einer zweiten Umgebung eingespielt (manuell, siehe Pflichten → Souveränität)" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Souveränität & Pflichten" description="Welche Verbindungen das System aufbauen kann, wohin Daten fließen und wie leicht ein Ausstieg wäre.">
        {isAgencyStaffUser(user) && (
          <Link href="/souveraenitaet/export" prefetch={false} className={btnGhostCls}><Download size={16} aria-hidden /> Agentur-Gesamtexport</Link>
        )}
      </PageHeader>

      {warnings.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="font-medium">Regionsverstöße</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map(({ ws, c }) => (
              <li key={`${ws.id}-${c.id}`}>{ws.name} (Region {ws.region}): {c.name} – {c.location}</li>
            ))}
          </ul>
        </div>
      )}

      {onDemand.length > 0 && (
        <div className="rounded-xl border border-sand-200 bg-sand-50 p-4 text-[15px] text-ink-800 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100">
          <p className="font-medium">Nur bei Nutzung</p>
          <ul className="mt-1 list-disc pl-5">
            {onDemand.map((c) => (
              <li key={c.id}>{c.name} ({c.location}): {c.note}</li>
            ))}
          </ul>
        </div>
      )}

      <Card title="Außenverbindungen">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-ink-400">
              <tr><th className="py-2 pr-4">Verbindung</th><th className="pr-4">Anbieter</th><th className="pr-4">Standort</th><th className="pr-4">Richtung</th><th className="pr-4">Status</th><th>Ersatz</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {conns.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="py-2 pr-4"><div className="font-medium">{c.name}</div><div className="text-sm text-ink-400 dark:text-ink-200">{c.note}</div></td>
                  <td className="pr-4">{c.provider}</td>
                  <td className="pr-4">{c.location}</td>
                  <td className="pr-4">{c.outbound ? "ausgehend" : "lokal/eingehend"}</td>
                  <td className="pr-4">{c.active ? <Badge tone={c.outbound && c.regions.length === 0 ? "warn" : "ok"}>aktiv</Badge> : <Badge>aus</Badge>}</td>
                  <td className="text-sm">{c.replaceable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Exit-Test">
          <ul className="space-y-2">
            {exitChecks.map((e) => (
              <li key={e.text} className="flex items-start gap-2">
                <Badge tone={e.ok === null ? "neutral" : e.ok ? "ok" : "warn"}>{e.ok === null ? "offen" : e.ok ? "ja" : "nein"}</Badge>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="KI-Nutzung (30 Tage)">
          {aiUsage.length === 0 ? (
            <p className="text-ink-400">Noch keine protokollierten KI-Aufrufe.</p>
          ) : (
            <table className="w-full text-left text-[15px]">
              <thead className="text-sm text-ink-400"><tr><th className="py-1">Zweck</th><th>Modell</th><th className="text-right">Aufrufe</th><th className="text-right">Ø Dauer</th></tr></thead>
              <tbody>
                {aiUsage.map((a) => (
                  <tr key={`${a.purpose}-${a.model}`}>
                    <td className="py-1">{a.purpose}</td>
                    <td className="font-mono text-sm">{a.model} <span className="text-ink-400">({a.provider})</span></td>
                    <td className="text-right tabular-nums">{formatNumber(a._count)}</td>
                    <td className="text-right tabular-nums">{a._avg.ms ? `${(a._avg.ms / 1000).toFixed(1)} s` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-sm text-ink-400 dark:text-ink-200">Protokolliert werden Zweck, Modell und Dauer – keine Inhalte.</p>
        </Card>
      </div>

      <Card title="Sub-Accounts">
        <table className="w-full text-left text-[15px]">
          <thead className="text-sm text-ink-400"><tr><th className="py-2">Sub-Account</th><th>Region</th><th>Pflichten erledigt</th><th>Offen</th><th /></tr></thead>
          <tbody className="divide-y divide-ink-100 dark:divide-white/10">
            {workspaces.map((w) => {
              const rows = compliance.filter((c) => c.workspaceId === w.id);
              const done = rows.filter((r) => r.status === "DONE" || r.status === "N_A").reduce((s, r) => s + r._count, 0);
              const total = rows.reduce((s, r) => s + r._count, 0);
              return (
                <tr key={w.id}>
                  <td className="py-2"><span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: w.brandPrimary }} aria-hidden />{w.name}</td>
                  <td><Badge tone="accent">{w.region}</Badge></td>
                  <td className="tabular-nums">{total ? `${done} / ${total}` : "Katalog nicht übernommen"}</td>
                  <td className="tabular-nums">{total - done}</td>
                  <td className="text-right"><Link className="text-accent-500 underline-offset-2 hover:underline dark:text-accent-100" href={`/sa/${w.slug}/pflichten`}>Pflichten öffnen</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-ink-400 dark:text-ink-200">Bereiche: {Object.values(FRAMEWORK_LABEL as Record<Framework, string>).join(" · ")}</p>
      </Card>

      <Card title="Beobachtungspunkt: Post-Quanten-Kryptografie">
        <p className="max-w-prose text-[15px] text-ink-600 dark:text-ink-200">
          Verschlüsselung (TLS, Signaturen) wird mittelfristig auf hybride, quantenresistente Verfahren umgestellt.
          Das CRM nutzt Standardbibliotheken (Node.js/OpenSSL, Postgres-TLS) und kann so ohne Umbau folgen.
          Empfehlungen des BSI regelmäßig prüfen; konkrete Fristen hier bewusst nicht genannt.
        </p>
      </Card>
    </div>
  );
}
