import Link from "next/link";
import { plural } from "@/lib/a-format";
import { Download, RefreshCw } from "lucide-react";
import { db } from "@/lib/db";
import { isAgencyStaffUser, requireUser } from "@/lib/auth";
import { NoAccess } from "@/components/users/NoAccess";
import { FLOW_DAYS, costsFor, loadRates, measureAll, toCostInput } from "@/lib/usage";
import { AI_PROFILES, fixedTotal, missingRates, projectCosts, referenceInput } from "@/lib/usage-cost";
import { Badge, Card, PageHeader, Stat, btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { BarList, DailyBars } from "@/components/analytics/Charts";
import { RatesForm } from "@/components/usage/RatesForm";
import { measureNowAction } from "./actions";

export const dynamic = "force-dynamic";

const eur = (v: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(v);
const int = (v: number) => new Intl.NumberFormat("de-DE").format(Math.round(v));
const mb = (bytes: number) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: bytes < 10 * 1024 ** 2 ? 2 : 0 }).format(bytes / 1024 ** 2)} MB`;

type SP = { n?: string; u?: string; ref?: string };

export default async function KostenPage({ searchParams }: { searchParams: Promise<SP> }) {
  // Nur Agentur-Inhaber/-Admins; andere sehen einen klaren Sperrhinweis statt einer stillen Umleitung
  if (!isAgencyStaffUser(await requireUser())) return <NoAccess what="Nutzung & Kosten" scope="agency" />;
  const sp = await searchParams;
  const [{ measuredAt, workspaces, unassignedAi }, rates] = await Promise.all([measureAll(), loadRates()]);
  const costs = costsFor(workspaces, rates);
  const missing = missingRates(rates);

  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const snaps = await db.usageSnapshot.groupBy({ by: ["date"], where: { date: { gte: since } }, _sum: { estCostCents: true }, orderBy: { date: "asc" } });
  const history = snaps.map((s) => ({ date: s.date.toISOString().slice(0, 10), kosten: Math.round((s._sum.estCostCents ?? 0) / 100) }));

  const total = workspaces.reduce((a, w) => a + costs[w.workspaceId].total, 0);
  const distinctUsers = await db.user.count({ where: { active: true, OR: [{ isAgencyAdmin: true }, { agencyRole: { in: ["owner", "admin"] } }, { memberships: { some: {} } }] } });

  // Kostentreiber über alle Sub-Accounts
  const sumOf = (k: "db" | "objects" | "email" | "aiIn" | "aiOut" | "fixedShare") => workspaces.reduce((a, w) => a + costs[w.workspaceId][k], 0);
  const drivers = [
    { label: "Datenbank (inkl. Vektoren)", value: sumOf("db") },
    { label: "Objektspeicher", value: sumOf("objects") },
    { label: "E-Mail-Versand", value: sumOf("email") },
    { label: `KI-Eingabe (${AI_PROFILES[rates.aiProfile]})`, value: sumOf("aiIn") },
    { label: `KI-Ausgabe (${AI_PROFILES[rates.aiProfile]})`, value: sumOf("aiOut") },
    { label: "Fixkosten Plattform", value: sumOf("fixedShare") },
  ].sort((a, b) => b.value - a.value);

  const purposes: Record<string, { calls: number; tokens: number }> = {};
  for (const w of workspaces)
    for (const [p, v] of Object.entries(w.ai30d.byPurpose)) {
      const x = (purposes[p] ??= { calls: 0, tokens: 0 });
      x.calls += v.calls;
      x.tokens += v.tokensIn + v.tokensOut;
    }

  // Was-wäre-wenn
  const n = Math.min(10_000, Math.max(1, Number(sp.n) || 10));
  const u = Math.min(1_000, Math.max(1, Number(sp.u) || 3));
  const refMode = sp.ref === "median" || sp.ref === "max" ? sp.ref : "avg";
  const ref = referenceInput(workspaces.map(toCostInput), refMode);
  const proj = projectCosts(ref, rates, n, u);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Nutzung & Kosten"
        description={`Gemessene Nutzung je Sub-Account und geschätzte Monatskosten. Flüsse (E-Mails, KI, Analytics) = letzte ${FLOW_DAYS} Tage. Schätzwerte – keine Rechnung.`}
      >
        <form action={measureNowAction}>
          <button className={btnGhostCls}><RefreshCw size={16} aria-hidden /> Jetzt messen</button>
        </form>
        <a href="/kosten/export" className={btnGhostCls}><Download size={16} aria-hidden /> CSV</a>
      </PageHeader>

      {missing.length > 0 && (
        <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-[15px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <strong>Kostensätze fehlen</strong> – sie zählen derzeit als 0 €: {missing.join(", ")}. Bitte unten mit echten Anbieterpreisen ergänzen.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Geschätzte Kosten / Monat" value={eur(total)} hint={`davon Fixkosten ${eur(fixedTotal(rates))}`} />
        <Stat label="Je Sub-Account (Ø)" value={eur(total / Math.max(1, workspaces.length))} hint={`${workspaces.length} Sub-Accounts`} />
        <Stat label="Je Benutzer (Ø)" value={eur(total / Math.max(1, distinctUsers))} hint={`${distinctUsers} Benutzer mit Zugriff`} />
        <Stat label={`KI-Tokens (${FLOW_DAYS} T.)`} value={int(workspaces.reduce((a, w) => a + w.ai30d.tokensIn + w.ai30d.tokensOut, 0))} hint={unassignedAi.calls ? `+ ${int(unassignedAi.calls)} Aufrufe ohne Sub-Account` : undefined} />
      </div>

      <Card title="Je Sub-Account">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[15px] tabular-nums">
            <thead>
              <tr className="text-sm text-ink-400 dark:text-ink-200">
                <th className="py-2 pr-4 font-medium">Sub-Account</th>
                <th className="py-2 pr-4 font-medium">Benutzer</th>
                <th className="py-2 pr-4 font-medium">Kontakte</th>
                <th className="py-2 pr-4 font-medium">Speicher (DB)</th>
                <th className="py-2 pr-4 font-medium">E-Mails</th>
                <th className="py-2 pr-4 font-medium">KI-Aufrufe</th>
                <th className="py-2 pr-4 font-medium">Tokens</th>
                <th className="py-2 pr-4 font-medium">Analytics</th>
                <th className="py-2 pr-4 font-medium">Kosten / Monat</th>
                <th className="py-2 font-medium">je Benutzer</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => {
                const c = costs[w.workspaceId];
                return (
                  <tr key={w.workspaceId} className="border-t border-ink-100 align-top dark:border-white/10">
                    <th scope="row" className="py-2 pr-4 font-medium"><Link className="hover:underline" href={`/sa/${w.slug}`}>{w.name}</Link></th>
                    <td className="py-2 pr-4">{w.users}</td>
                    <td className="py-2 pr-4">{int(w.rows.Contact ?? 0)}</td>
                    <td className="py-2 pr-4">{mb(w.storage.dbBytes)}{w.storage.embeddingBytes > 0 && <span className="block text-xs text-ink-400">davon Vektoren {mb(w.storage.embeddingBytes)}</span>}</td>
                    <td className="py-2 pr-4">{int(w.emails30d.total)}{w.emails30d.total > 0 && <span className="block text-xs text-ink-400">T {w.emails30d.transactional} · K {w.emails30d.campaign} · 1:1 {w.emails30d.one_to_one}</span>}</td>
                    <td className="py-2 pr-4">{int(w.ai30d.calls)}{w.ai30d.ms > 0 && <span className="block text-xs text-ink-400">{int(w.ai30d.ms / 1000)} s Rechenzeit</span>}</td>
                    <td className="py-2 pr-4">{int(w.ai30d.tokensIn + w.ai30d.tokensOut)}</td>
                    <td className="py-2 pr-4">{int(w.analyticsEvents30d)}</td>
                    <td className="py-2 pr-4 font-semibold">{eur(c.total)}<span className="block text-xs font-normal text-ink-400">variabel {eur(c.variable)} · fix {eur(c.fixedShare)}</span></td>
                    <td className="py-2">{eur(c.perUser)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-400 dark:text-ink-200">
          Gemessen {measuredAt.toLocaleString("de-DE")}. Speicher = Zeilengröße × 1,3 (Indizes) + Vektoren × 2 (HNSW-Index); Worker-Rechenzeit wird nicht gemessen, nur Job-Anzahl. Agentur-Admins zählen in jedem Sub-Account als Benutzer.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top-Kostentreiber (€ / Monat)">
          <BarList rows={drivers.map((d) => ({ label: d.label, value: Math.round(d.value * 100) / 100 }))} valueLabel="Euro" empty="Noch keine Kosten." />
        </Card>
        <Card title={`KI-Nutzung nach Zweck (${FLOW_DAYS} Tage)`}>
          <BarList
            rows={Object.entries(purposes).sort((a, b) => b[1].tokens - a[1].tokens || b[1].calls - a[1].calls).map(([p, v]) => ({ label: p, value: v.tokens, sub: plural(v.calls, "Aufruf", "Aufrufe") }))}
            valueLabel="Tokens"
            empty="Noch keine KI-Aufrufe."
          />
        </Card>
      </div>

      <Card title="Verlauf der geschätzten Kosten (90 Tage, € / Monat)">
        {history.length === 0 ? (
          <p className="text-ink-400 dark:text-ink-200">Noch keine Snapshots. Der Worker misst täglich; „Jetzt messen“ legt den ersten an.</p>
        ) : (
          <DailyBars data={history} series={[{ key: "kosten", label: "Kosten (€)", className: "fill-accent-500 dark:fill-accent-100" }]} title="Geschätzte Monatskosten je Tag" />
        )}
      </Card>

      <Card title="Was wäre wenn? Hochrechnung für Paketpreise">
        <form className="grid gap-4 md:grid-cols-4" method="get">
          <label className="block"><span className={labelCls}>Sub-Accounts</span><input name="n" type="number" min={1} max={10000} defaultValue={n} className={inputCls} /></label>
          <label className="block"><span className={labelCls}>Benutzer je Sub-Account</span><input name="u" type="number" min={1} max={1000} defaultValue={u} className={inputCls} /></label>
          <label className="block">
            <span className={labelCls}>Nutzung je Sub-Account wie …</span>
            <select name="ref" defaultValue={refMode} className={inputCls}>
              <option value="avg">Durchschnitt der gemessenen</option>
              <option value="median">Median der gemessenen</option>
              <option value="max">stärkster gemessener</option>
            </select>
          </label>
          <div className="flex items-end"><button className={btnCls}>Berechnen</button></div>
        </form>
        <dl className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div><dt className="text-sm text-ink-400 dark:text-ink-200">Gesamt / Monat</dt><dd className="font-display text-2xl">{eur(proj.total)}</dd></div>
          <div><dt className="text-sm text-ink-400 dark:text-ink-200">je Sub-Account</dt><dd className="font-display text-2xl">{eur(proj.perSubAccount)}</dd></div>
          <div><dt className="text-sm text-ink-400 dark:text-ink-200">je Benutzer</dt><dd className="font-display text-2xl">{eur(proj.perUser)}</dd></div>
          <div><dt className="text-sm text-ink-400 dark:text-ink-200">variabel je Sub-Account</dt><dd className="font-display text-2xl">{eur(proj.variablePerSubAccount)}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-ink-600 dark:text-ink-200">
          Annahme: variable Kosten wachsen linear mit den Sub-Accounts, Fixkosten ({eur(proj.fixed)}) bleiben gleich. Benutzer beeinflussen die Kosten nur über ihre Nutzung – die Hochrechnung zeigt den Kostenanteil je Benutzer. Die Referenz beruht auf {workspaces.length} gemessenen Sub-Accounts{missing.length > 0 && <> – <Badge tone="warn">unvollständige Kostensätze</Badge></>}.
        </p>
      </Card>

      <Card title="Kostensätze">
        <RatesForm rates={rates} />
      </Card>
    </div>
  );
}
