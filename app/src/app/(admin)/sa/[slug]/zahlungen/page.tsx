import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { formatCents } from "@/lib/invoice";
import { PAYMENT_STATUSES } from "@/lib/payments/types";
import { Badge, Card, Empty, PageHeader, Stat, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { PayForm } from "@/components/payments/forms";
import { PAYMENT_STATUS, PROVIDER_LABEL } from "@/components/payments/labels";
import { refundAction, syncPaymentAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { status?: string; anbieter?: string; q?: string; von?: string; bis?: string };

export default async function PaymentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const editable = can(access, "invoices", "edit");
  const approver = hasSpecial(access, "approve");

  const where: Prisma.PaymentWhereInput = { workspaceId: ws.id };
  if (sp.status && (PAYMENT_STATUSES as readonly string[]).includes(sp.status)) where.status = sp.status;
  if (sp.anbieter && PROVIDER_LABEL[sp.anbieter]) where.providerRef = { provider: sp.anbieter };
  const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  const von = day(sp.von);
  const bis = day(sp.bis);
  if (von || bis) where.createdAt = { ...(von ? { gte: von } : {}), ...(bis ? { lt: new Date(bis.getTime() + 86400_000) } : {}) };
  if (sp.q?.trim()) {
    const invs = await db.invoice.findMany({ where: { workspaceId: ws.id, number: { contains: sp.q.trim(), mode: "insensitive" } }, select: { id: true }, take: 200 });
    where.invoiceId = { in: invs.map((i) => i.id) };
  }

  const [payments, providers, sums] = await Promise.all([
    db.payment.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { providerRef: { select: { provider: true, mode: true } } } }),
    db.paymentProvider.count({ where: { workspaceId: ws.id } }),
    db.payment.groupBy({ by: ["status"], where: { workspaceId: ws.id, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, _sum: { amountCents: true, refundedCents: true }, _count: true }),
  ]);
  const invoices = await db.invoice.findMany({ where: { id: { in: payments.map((p) => p.invoiceId).filter((x): x is string => Boolean(x)) }, workspaceId: ws.id }, select: { id: true, number: true, buyerName: true } });
  const inv = new Map(invoices.map((i) => [i.id, i]));
  const sumOf = (st: string[]) => sums.filter((s) => st.includes(s.status)).reduce((a, s) => a + (s._sum.amountCents ?? 0) - (s._sum.refundedCents ?? 0), 0);
  const countOf = (st: string[]) => sums.filter((s) => st.includes(s.status)).reduce((a, s) => a + s._count, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Zahlungen" description="Online-Zahlungen zu Rechnungen (Bezahllinks über Mollie, Revolut, Unzer). Rechnungen werden erst bei vollständiger Zahlung als bezahlt markiert." />

      {providers === 0 && (
        <Card>
          <p className="text-[15px]">
            Noch kein Zahlungsanbieter verbunden. <Link className="font-medium text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/zahlungen/anbieter`}>Anbieter verbinden</Link> – danach erscheint auf Rechnungen und im Kundenportal ein „Online bezahlen“-Button und der Platzhalter <code>{"{{ invoice.paymentLink }}"}</code> wird befüllt.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Eingegangen (30 Tage)" value={formatCents(sumOf(["paid", "partially_refunded"]))} hint={`${countOf(["paid", "partially_refunded"])} Zahlungen`} />
        <Stat label="Offen / in Bearbeitung" value={countOf(["open", "pending", "authorized"])} />
        <Stat label="Fehlgeschlagen / abgebrochen" value={countOf(["failed", "canceled", "expired"])} />
        <Stat label="Erstattet" value={countOf(["refunded", "partially_refunded"])} />
      </div>

      <Card title="Filter">
        <form className="grid gap-3 sm:grid-cols-5" method="get">
          <div>
            <label htmlFor="f-status" className={labelCls}>Status</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ""} className={inputCls}>
              <option value="">alle</option>
              {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{PAYMENT_STATUS[s].label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-anbieter" className={labelCls}>Anbieter</label>
            <select id="f-anbieter" name="anbieter" defaultValue={sp.anbieter ?? ""} className={inputCls}>
              <option value="">alle</option>
              {Object.entries(PROVIDER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-q" className={labelCls}>Rechnungsnummer</label>
            <input id="f-q" name="q" defaultValue={sp.q ?? ""} className={inputCls} />
          </div>
          <div>
            <label htmlFor="f-von" className={labelCls}>Von</label>
            <input id="f-von" name="von" type="date" defaultValue={sp.von ?? ""} className={inputCls} />
          </div>
          <div>
            <label htmlFor="f-bis" className={labelCls}>Bis</label>
            <input id="f-bis" name="bis" type="date" defaultValue={sp.bis ?? ""} className={inputCls} />
          </div>
          <div className="sm:col-span-5"><button className={btnGhostCls}>Filtern</button></div>
        </form>
      </Card>

      <Card title={`Zahlungen (${payments.length}${payments.length === 200 ? "+" : ""})`}>
        {payments.length === 0 ? (
          <Empty>Keine Zahlungen gefunden.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead className="text-sm text-ink-400">
                <tr><th className="py-2">Angelegt</th><th>Rechnung</th><th>Anbieter</th><th>Zahlart</th><th className="text-right">Betrag</th><th className="pl-4">Status</th><th>Aktionen</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-100 align-top dark:divide-white/10">
                {payments.map((p) => {
                  const i = p.invoiceId ? inv.get(p.invoiceId) : undefined;
                  const st = PAYMENT_STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
                  const refundable = ["paid", "partially_refunded"].includes(p.status) && p.amountCents > p.refundedCents;
                  return (
                    <tr key={p.id}>
                      <td className="py-2 whitespace-nowrap">{formatDate(p.createdAt, true)}{p.paidAt && <span className="block text-sm text-ink-400">bezahlt {formatDate(p.paidAt, true)}</span>}</td>
                      <td>{i ? <Link className="font-mono text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/rechnungen/${i.id}`}>{i.number}</Link> : "–"}{i?.buyerName && <span className="block text-sm text-ink-400">{i.buyerName}</span>}</td>
                      <td>{PROVIDER_LABEL[p.providerRef.provider] ?? p.providerRef.provider}{p.providerRef.mode === "test" && <span className="ml-1"><Badge tone="warn">Test</Badge></span>}<span className="block font-mono text-xs text-ink-400">{p.externalId}</span></td>
                      <td>{p.method ?? "–"}</td>
                      <td className="text-right tabular-nums">{formatCents(p.amountCents, p.currency)}{p.refundedCents > 0 && <span className="block text-sm text-ink-400">−{formatCents(p.refundedCents, p.currency)} erstattet</span>}</td>
                      <td className="pl-4"><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td className="space-y-2">
                        {editable && <PayForm action={syncPaymentAction.bind(null, slug, p.id)} submit="Status abfragen" tone="ghost" className="space-y-1" />}
                        {editable && refundable && (
                          approver ? (
                            <details>
                              <summary className="cursor-pointer text-sm">Erstatten …</summary>
                              <PayForm action={refundAction.bind(null, slug, p.id)} submit="Erstattung auslösen" tone="danger" className="mt-2 space-y-2" confirm="Erstattung jetzt beim Anbieter auslösen? Das Geld geht an den Kunden zurück.">
                                <label className="block text-sm">
                                  Betrag in €
                                  <input name="amount" inputMode="decimal" defaultValue={((p.amountCents - p.refundedCents) / 100).toFixed(2).replace(".", ",")} className={inputCls} />
                                </label>
                                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" /> Ich habe die Erstattung geprüft (Freigabe).</label>
                              </PayForm>
                            </details>
                          ) : (
                            <p className="text-sm text-ink-400">Erstatten erfordert „Freigaben erteilen“.</p>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
