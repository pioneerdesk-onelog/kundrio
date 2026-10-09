import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { computeTotals, formatCents, parseItems, STATUS_LABEL } from "@/lib/invoice";
import { cancellationEffectiveDate, INTERVAL_LABEL, isInterval, isoDay, type Interval } from "@/lib/billing/periods";
import { DUNNING_LABEL } from "@/lib/billing/dunning";
import { getAutoSend } from "@/lib/billing/service";
import { portalUrl } from "@/lib/billing/portal";
import { Badge, Card, PageHeader, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { StateForm } from "@/components/billing/forms";
import { ITEM_STATUS, SUB_STATUS } from "@/components/billing/labels";
import { cancelSubscriptionAction, pauseSubscriptionAction, rotatePortalLink, setAutoSendAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { ws, access } = await pageAccess(slug);
  const sub = await db.subscription.findFirst({ where: { id, workspaceId: ws.id }, include: { contact: true, mandate: true } });
  if (!sub) notFound();
  const [invoices, auto, link] = await Promise.all([
    db.invoice.findMany({ where: { workspaceId: ws.id, subscriptionId: sub.id }, orderBy: { serviceFrom: "desc" } }),
    getAutoSend(sub.id),
    portalUrl(sub.contactId),
  ]);
  // Letzter Einzugsversuch je Rechnung (Rückläufer bleiben sichtbar)
  const debits = await db.directDebitItem.findMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } }, orderBy: { batch: { createdAt: "asc" } }, select: { invoiceId: true, status: true, returnReason: true } });
  const autoBy = auto.by?.startsWith("user:") ? await db.user.findUnique({ where: { id: auto.by.slice(5) }, select: { name: true, email: true } }) : null;
  const debitBy = new Map(debits.map((d) => [d.invoiceId, d]));
  const items = parseItems(sub.items);
  const t = computeTotals(items);
  const interval = (isInterval(sub.interval) ? sub.interval : "monthly") as Interval;
  const editable = can(access, "invoices", "edit");
  const running = sub.status === "active" || sub.status === "paused";
  const preview = running
    ? cancellationEffectiveDate({ startDate: sub.startDate, interval, minTermMonths: sub.minTermMonths, noticePeriodDays: sub.noticePeriodDays, consumer: sub.consumer, requestedAt: new Date(), nextBillingDate: sub.nextBillingDate })
    : null;
  const name = sub.contact.company || [sub.contact.firstName, sub.contact.lastName].filter(Boolean).join(" ") || sub.contact.email || "Kunde";

  return (
    <div className="space-y-6">
      <PageHeader title={`Abo · ${name}`} description={`${INTERVAL_LABEL[interval]} · ${formatCents(t.grossCents)} brutto je Abrechnung`}>
        <Badge tone={SUB_STATUS[sub.status]?.tone ?? "neutral"}>{SUB_STATUS[sub.status]?.label ?? sub.status}</Badge>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Vertrag">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[15px]">
            <dt className="text-ink-400">Kunde</dt><dd><Link className="text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/kontakte/${sub.contactId}`}>{name}</Link>{sub.consumer && " (Verbraucher)"}</dd>
            <dt className="text-ink-400">Positionen</dt><dd>{items.map((i) => `${i.qty.toLocaleString("de-DE")} × ${i.title} (${formatCents(i.unitCents)})`).join(", ")}</dd>
            <dt className="text-ink-400">Beginn</dt><dd>{formatDate(sub.startDate)}</dd>
            <dt className="text-ink-400">Mindestlaufzeit</dt><dd>{sub.minTermMonths ? `${sub.minTermMonths} Monate` : "keine"}</dd>
            <dt className="text-ink-400">Kündigungsfrist</dt><dd>{sub.noticePeriodDays} Tage</dd>
            <dt className="text-ink-400">Nächste Abrechnung</dt><dd>{running || sub.status === "cancelled" ? formatDate(sub.nextBillingDate) : "–"}</dd>
            {sub.cancelledAt && <><dt className="text-ink-400">Gekündigt am</dt><dd>{formatDate(sub.cancelledAt)} · endet {formatDate(sub.endDate)}</dd></>}
            <dt className="text-ink-400">Zahlung</dt>
            <dd>{sub.paymentMethod === "sepa" && sub.mandate ? `SEPA-Lastschrift · Mandat ${sub.mandate.mandateRef} · IBAN ···${sub.mandate.ibanLast4} (${sub.mandate.status})` : "Überweisung"}</dd>
          </dl>
        </Card>

        <Card title="Steuerung">
          <div className="space-y-5">
            <section>
              <h3 className="mb-1 font-medium">Rechnungen automatisch versenden</h3>
              <p className="mb-2 text-sm text-ink-400 dark:text-ink-200">
                {auto.enabled
                  ? `Eingeschaltet von ${autoBy?.name ?? autoBy?.email ?? "?"} am ${formatDate(auto.at ? new Date(auto.at) : null)}. Abo-Rechnungen gehen ohne Prüfung an ${sub.contact.email ?? "den Kunden"}.`
                  : "Aus: Abo-Rechnungen bleiben Entwurf, die zuständige Person bekommt eine Aufgabe zur Prüfung."}
              </p>
              {editable && (
                <form action={setAutoSendAction.bind(null, slug, sub.id, !auto.enabled)}>
                  <button className={btnGhostCls}>{auto.enabled ? "Automatischen Versand ausschalten" : "Automatischen Versand einschalten"}</button>
                </form>
              )}
            </section>

            {editable && running && (
              <section>
                <h3 className="mb-1 font-medium">{sub.status === "paused" ? "Abo fortsetzen" : "Abo pausieren"}</h3>
                <p className="mb-2 text-sm text-ink-400 dark:text-ink-200">Pausierte Abos werden nicht abgerechnet; nach dem Fortsetzen werden offene Perioden nachberechnet.</p>
                <form action={pauseSubscriptionAction.bind(null, slug, sub.id, sub.status !== "paused")}>
                  <button className={btnGhostCls}>{sub.status === "paused" ? "Fortsetzen" : "Pausieren"}</button>
                </form>
              </section>
            )}

            {editable && running && preview && (
              <section>
                <h3 className="mb-1 font-medium">Kündigen</h3>
                <p className="mb-2 text-sm text-ink-400 dark:text-ink-200">
                  Bei Eingang heute endet das Abo zum <strong>{formatDate(preview)}</strong>{sub.consumer ? " (Verbraucher: höchstens ein Monat Frist nach der Mindestlaufzeit, § 309 Nr. 9 BGB)" : ""}.
                </p>
                <StateForm action={cancelSubscriptionAction.bind(null, slug, sub.id)} submit="Kündigung erfassen" confirm="Abo wirklich kündigen?">
                  <div>
                    <label htmlFor="requestedAt" className={labelCls}>Kündigung eingegangen am</label>
                    <input id="requestedAt" name="requestedAt" type="date" defaultValue={isoDay(new Date())} className={inputCls} />
                  </div>
                </StateForm>
              </section>
            )}

            <section>
              <h3 className="mb-1 font-medium">Kundenportal</h3>
              <p className="mb-2 text-sm text-ink-400 dark:text-ink-200">Persönlicher Link für den Kunden: Status, Rechnungen, Kündigungsbutton.</p>
              <input readOnly value={link} aria-label="Link zum Kundenportal" className={`${inputCls} font-mono text-xs`} />
              {editable && (
                <form action={rotatePortalLink.bind(null, slug, sub.contactId)} className="mt-2">
                  <button className={btnGhostCls}>Neuen Link ausstellen (alter wird ungültig)</button>
                </form>
              )}
            </section>
          </div>
        </Card>
      </div>

      <Card title="Rechnungshistorie">
        {invoices.length === 0 ? <p className="text-[15px] text-ink-400">Noch keine Rechnung. Die erste entsteht am {formatDate(sub.nextBillingDate)}.</p> : (
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-ink-400"><tr><th className="py-2">Nummer</th><th>Leistungszeitraum</th><th>Fällig</th><th className="text-right">Brutto</th><th className="pl-4">Status</th><th>Lastschrift</th><th>Mahnstufe</th></tr></thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {invoices.map((i) => {
                const d = debitBy.get(i.id);
                return (
                  <tr key={i.id}>
                    <td className="py-2"><Link className="font-mono text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/rechnungen/${i.id}`}>{i.number}</Link></td>
                    <td>{formatDate(i.serviceFrom)} – {formatDate(i.serviceTo)}</td>
                    <td>{formatDate(i.dueDate)}</td>
                    <td className="text-right tabular-nums">{formatCents(i.grossCents)}</td>
                    <td className="pl-4"><Badge tone={i.status === "PAID" ? "ok" : i.status === "SENT" ? "accent" : "neutral"}>{STATUS_LABEL[i.status] ?? i.status}</Badge></td>
                    <td>{d ? `${ITEM_STATUS[d.status]?.label ?? d.status}${d.returnReason ? ` (${d.returnReason})` : ""}` : "–"}</td>
                    <td>{i.dunningLevel ? `${DUNNING_LABEL[i.dunningLevel]} · ${formatDate(i.dunnedAt)}` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
