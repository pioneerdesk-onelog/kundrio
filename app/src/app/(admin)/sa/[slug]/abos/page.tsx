import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { computeTotals, formatCents, parseItems } from "@/lib/invoice";
import { INTERVAL_LABEL, isInterval } from "@/lib/billing/periods";
import { subscriptionMetrics } from "@/lib/billing/metrics";
import { Badge, Card, Empty, PageHeader, Stat, btnCls } from "@/components/ui";
import { StateForm } from "@/components/billing/forms";
import { SUB_STATUS } from "@/components/billing/labels";
import { runBillingNow } from "./actions";

export const dynamic = "force-dynamic";


export default async function AbosPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string; zahlung?: string; q?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const status = sp.status && SUB_STATUS[sp.status] ? sp.status : undefined;
  const method = sp.zahlung === "sepa" || sp.zahlung === "transfer" ? sp.zahlung : undefined;
  const q = sp.q?.trim().slice(0, 100);
  const [all, list] = await Promise.all([
    db.subscription.findMany({ where: { workspaceId: ws.id }, select: { status: true, interval: true, items: true, startDate: true, cancelledAt: true, endDate: true } }),
    db.subscription.findMany({
      where: {
        workspaceId: ws.id,
        status,
        paymentMethod: method,
        ...(q ? { contact: { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { lastName: { contains: q, mode: "insensitive" as const } }, { company: { contains: q, mode: "insensitive" as const } }] } } : {}),
      },
      include: { contact: true, mandate: { select: { mandateRef: true, ibanLast4: true } } },
      orderBy: [{ status: "asc" }, { nextBillingDate: "asc" }],
      take: 300,
    }),
  ]);
  const m = subscriptionMetrics(all, new Date());
  const link = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ status, zahlung: method, q, ...p }).filter(([, v]) => v) as [string, string][]);
    return `/sa/${slug}/abos${s.size ? `?${s}` : ""}`;
  };
  const chip = (on: boolean) => `rounded-full px-3 py-1 text-sm ${on ? "bg-accent-500 text-white" : "bg-sand-100 text-ink-800 hover:bg-sand-200 dark:bg-white/10 dark:text-ink-100"}`;
  const editable = can(access, "invoices", "edit");

  return (
    <div className="space-y-6">
      <PageHeader title="Abos" description="Wiederkehrende Leistungen: Abrechnung, Lastschrift, Kündigung.">
        {editable && <Link href={`/sa/${slug}/abos/neu`} className={btnCls}>Neues Abo</Link>}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="MRR (netto)" value={formatCents(m.mrrCents)} hint="monatlich wiederkehrend" />
        <Stat label="ARR (netto)" value={formatCents(m.arrCents)} />
        <Stat label="Aktive Abos" value={m.active} />
        <Stat label="Neu / gekündigt" value={`${m.newThisMonth} / ${m.cancelledThisMonth}`} hint="in diesem Monat" />
        <Stat label="Churn" value={`${(m.churn * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`} hint="Kündigungen ÷ Bestand am Monatsanfang" />
      </div>

      <form className="flex flex-wrap items-center gap-2" action={`/sa/${slug}/abos`}>
        <Link href={link({ status: undefined })} className={chip(!status)}>Alle</Link>
        {Object.entries(SUB_STATUS).map(([k, v]) => <Link key={k} href={link({ status: status === k ? undefined : k })} className={chip(status === k)}>{v.label}</Link>)}
        <span className="mx-2 w-px self-stretch bg-ink-200" aria-hidden />
        <Link href={link({ zahlung: method === "sepa" ? undefined : "sepa" })} className={chip(method === "sepa")}>Lastschrift</Link>
        <Link href={link({ zahlung: method === "transfer" ? undefined : "transfer" })} className={chip(method === "transfer")}>Überweisung</Link>
        {status && <input type="hidden" name="status" value={status} />}
        {method && <input type="hidden" name="zahlung" value={method} />}
        <label className="sr-only" htmlFor="q">Suche</label>
        <input id="q" name="q" defaultValue={q} placeholder="Kunde suchen …" className="ml-auto rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-ink-900" />
      </form>

      <Card>
        {list.length === 0 ? <Empty>Noch keine Abos. Legen Sie zuerst Produkte an, dann ein Abo für einen Kontakt.</Empty> : (
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-ink-400"><tr><th className="py-2">Kunde</th><th>Leistung</th><th>Rhythmus</th><th className="text-right">Brutto</th><th className="pl-4">Zahlung</th><th>Nächste Abrechnung</th><th>Status</th></tr></thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {list.map((s) => {
                const items = parseItems(s.items);
                const name = s.contact.company || [s.contact.firstName, s.contact.lastName].filter(Boolean).join(" ") || s.contact.email || "–";
                return (
                  <tr key={s.id}>
                    <td className="py-2"><Link href={`/sa/${slug}/abos/${s.id}`} className="font-medium text-accent-500 hover:underline dark:text-accent-100">{name}</Link></td>
                    <td>{items.map((i) => i.title).join(", ")}</td>
                    <td>{isInterval(s.interval) ? INTERVAL_LABEL[s.interval] : s.interval}</td>
                    <td className="text-right tabular-nums">{formatCents(computeTotals(items).grossCents)}</td>
                    <td className="pl-4">{s.paymentMethod === "sepa" ? `Lastschrift ···${s.mandate?.ibanLast4 ?? "?"}` : "Überweisung"}</td>
                    <td>{s.status === "active" || s.status === "cancelled" ? formatDate(s.nextBillingDate) : "–"}{s.endDate && <span className="block text-sm text-ink-400">endet {formatDate(s.endDate)}</span>}</td>
                    <td><Badge tone={SUB_STATUS[s.status]?.tone ?? "neutral"}>{SUB_STATUS[s.status]?.label ?? s.status}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {editable && (
        <Card title="Abrechnungslauf">
          <p className="mb-3 text-[15px] text-ink-600 dark:text-ink-200">
            Läuft jede Nacht automatisch. Fällige Perioden werden als Rechnungsentwurf mit Leistungszeitraum angelegt (je Periode genau einmal) und es entsteht eine Aufgabe zur Prüfung.
            Nur bei Abos mit eingeschaltetem „automatisch versenden“ geht die Rechnung direkt raus.
          </p>
          <StateForm action={runBillingNow.bind(null, slug)} submit="Jetzt abrechnen" ghost />
        </Card>
      )}
    </div>
  );
}
