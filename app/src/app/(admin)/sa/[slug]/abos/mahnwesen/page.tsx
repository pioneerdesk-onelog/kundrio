import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { formatCents } from "@/lib/invoice";
import { DUNNING_LABEL } from "@/lib/billing/dunning";
import { getDunningSettings } from "@/lib/billing/service";
import { Card, Empty, PageHeader, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { StateForm } from "@/components/billing/forms";
import { requestDunningAction, runDunningNow, saveDunningAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DunningPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const editable = can(access, "invoices", "edit");
  const now = new Date();
  const [s, overdue, pending] = await Promise.all([
    getDunningSettings(ws.id),
    db.invoice.findMany({ where: { workspaceId: ws.id, kind: "INVOICE", status: "SENT", dueDate: { lt: now } }, orderBy: { dueDate: "asc" }, take: 300 }),
    db.approval.findMany({ where: { workspaceId: ws.id, kind: "dunning.send", status: "pending" }, select: { payload: true } }),
  ]);
  const waiting = new Set(pending.map((p) => (p.payload as { invoiceId?: string }).invoiceId));
  const inCollection = new Set((await db.directDebitItem.findMany({ where: { invoiceId: { in: overdue.map((i) => i.id) }, status: "pending" }, select: { invoiceId: true } })).map((x) => x.invoiceId));
  const days = (d: Date | null) => (d ? Math.floor((now.getTime() - d.getTime()) / 864e5) : 0);
  const euro = (c: number) => (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <PageHeader title="Mahnwesen" description="Überfällige Rechnungen in drei Stufen. Jede Mahnung wartet im Freigabe-Eingang auf eine Person, bevor sie versendet wird." />

      <Card title="Überfällige Rechnungen">
        {overdue.length === 0 ? <Empty>Keine überfälligen Rechnungen.</Empty> : (
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-ink-400"><tr><th className="py-2">Rechnung</th><th>Kunde</th><th>Fällig</th><th className="text-right">Betrag</th><th className="pl-4">Letzte Stufe</th><th>Aktion</th></tr></thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {overdue.map((i) => (
                <tr key={i.id}>
                  <td className="py-2 font-mono"><Link className="text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/rechnungen/${i.id}`}>{i.number}</Link></td>
                  <td>{i.buyerName}</td>
                  <td>{formatDate(i.dueDate)} <span className="text-sm text-red-700 dark:text-red-300">({days(i.dueDate)} Tage)</span></td>
                  <td className="text-right tabular-nums">{formatCents(i.grossCents)}</td>
                  <td className="pl-4">{i.dunningLevel ? `${DUNNING_LABEL[i.dunningLevel]} · ${formatDate(i.dunnedAt)}` : "–"}</td>
                  <td>
                    {inCollection.has(i.id) ? <span className="text-sm text-ink-400">im Lastschrifteinzug</span>
                      : waiting.has(i.id) ? <Link className="text-sm text-accent-500 hover:underline dark:text-accent-100" href="/freigaben">wartet auf Freigabe</Link>
                      : editable && i.dunningLevel < 3 ? (
                        <form action={requestDunningAction.bind(null, slug, i.id, i.dunningLevel + 1)}>
                          <button className={btnGhostCls}>{DUNNING_LABEL[i.dunningLevel + 1]} anfragen</button>
                        </form>
                      ) : <span className="text-sm text-ink-400">{i.dunningLevel >= 3 ? "Stufen ausgeschöpft" : ""}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {editable && <div className="mt-4"><StateForm action={runDunningNow.bind(null, slug)} submit="Mahnlauf jetzt starten" ghost /></div>}
      </Card>

      <Card title="Einstellungen">
        {editable ? (
          <StateForm action={saveDunningAction.bind(null, slug)} submit="Speichern">
            <label className="flex items-center gap-2 text-[15px]">
              <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Automatischer Mahnlauf (täglich, erzeugt nur Freigabe-Anfragen)
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              {([1, 2, 3] as const).map((l) => (
                <fieldset key={l} className="space-y-2 rounded-md border border-ink-100 p-3 dark:border-white/10">
                  <legend className="px-1 font-medium">{DUNNING_LABEL[l]}</legend>
                  <div>
                    <label htmlFor={`days${l}`} className={labelCls}>{l === 1 ? "Tage nach Fälligkeit" : "Tage nach vorheriger Stufe"}</label>
                    <input id={`days${l}`} name={`days${l}`} type="number" min={1} max={90} defaultValue={l === 1 ? s.daysToLevel1 : l === 2 ? s.daysToLevel2 : s.daysToLevel3} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor={`fee${l}`} className={labelCls}>Mahngebühr (€)</label>
                    <input id={`fee${l}`} name={`fee${l}`} inputMode="decimal" defaultValue={euro(s.feeCents[l - 1] ?? 0)} className={inputCls} />
                  </div>
                </fieldset>
              ))}
            </div>
            {([1, 2, 3] as const).map((l) => (
              <fieldset key={l} className="space-y-2">
                <legend className="font-medium">Text {DUNNING_LABEL[l]}</legend>
                <input name={`subject${l}`} aria-label={`Betreff ${DUNNING_LABEL[l]}`} defaultValue={s.texts[String(l) as "1"].subject} className={inputCls} />
                <textarea name={`body${l}`} aria-label={`Text ${DUNNING_LABEL[l]}`} rows={6} defaultValue={s.texts[String(l) as "1"].body} className={`${inputCls} font-mono text-sm`} />
              </fieldset>
            ))}
            <p className="text-sm text-ink-400 dark:text-ink-200">
              Platzhalter wie bei Belegen ({"{{ kunde.ansprechpartner }}"}, {"{{ dokument.nummer }}"}, {"{{ dokument.summe_brutto }}"}, {"{{ dokument.faellig_am }}"}, {"{{ absender.firma }}"}) sowie {"{{ mahnung.stufe }}"}, {"{{ mahnung.gebuehr }}"} und {"{{ mahnung.gebuehr_text }}"}.
              Mahngebühren erscheinen nur im Text – die versendete Rechnung bleibt unverändert (GoBD); Gebühren bei Bedarf als eigene Rechnung stellen. Verbraucher: nur tatsächliche Kosten (pauschal meist 1–3 €), bei Unternehmen zusätzlich 40 € Pauschale nach § 288 Abs. 5 BGB möglich.
            </p>
          </StateForm>
        ) : <p className="text-[15px]">Stufen nach {s.daysToLevel1} / {s.daysToLevel2} / {s.daysToLevel3} Tagen.</p>}
      </Card>
    </div>
  );
}
