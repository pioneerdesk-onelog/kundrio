import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { formatCents } from "@/lib/invoice";
import { RETURN_REASONS } from "@/lib/billing/sepa";
import { Badge, Card, PageHeader, btnCls, inputCls } from "@/components/ui";
import { StateForm } from "@/components/billing/forms";
import { BATCH_STATUS, ITEM_STATUS } from "@/components/billing/labels";
import { returnItemAction, settleBatchAction, submitBatchAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function BatchPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { ws, access } = await pageAccess(slug);
  const batch = await db.directDebitBatch.findFirst({ where: { id, workspaceId: ws.id }, include: { items: { include: { mandate: { select: { mandateRef: true, ibanLast4: true, accountHolder: true } } } } } });
  if (!batch) notFound();
  const invoices = await db.invoice.findMany({ where: { id: { in: batch.items.map((i) => i.invoiceId) }, workspaceId: ws.id }, select: { id: true, number: true, buyerName: true } });
  const inv = new Map(invoices.map((i) => [i.id, i]));
  const editable = can(access, "invoices", "edit");
  const approver = hasSpecial(access, "approve");

  return (
    <div className="space-y-6">
      <PageHeader title={`Lastschrift-Stapel ${batch.messageId}`} description={`Einzug am ${formatDate(batch.collectionDate)} · ${batch.count} Lastschrift(en) · ${formatCents(batch.totalCents)}`}>
        <Badge tone={BATCH_STATUS[batch.status]?.tone ?? "neutral"}>{BATCH_STATUS[batch.status]?.label ?? batch.status}</Badge>
      </PageHeader>

      <Card title="Ablauf">
        <ol className="space-y-4 text-[15px]">
          <li>
            <strong>1. XML erzeugen</strong> – Datei im Format pain.008.001.08 (DK-Spezifikation) herunterladen und im Online-Banking bzw. per EBICS einreichen.
            <div className="mt-2">
              {editable && <a href={`/sa/${slug}/abos/lastschrift/${batch.id}/xml`} className={btnCls} download>pain.008-XML herunterladen</a>}
            </div>
          </li>
          <li>
            <strong>2. Als eingereicht markieren</strong> – nach dem Hochladen bei der Bank (Recht „Freigaben erteilen“).
            {batch.status === "exported" && editable && (
              approver ? <StateForm action={submitBatchAction.bind(null, slug, batch.id)} submit="Bei der Bank eingereicht" ghost className="mt-2 space-y-2" confirm="Wurde die Datei bei der Bank eingereicht?" />
                : <p className="mt-1 text-sm text-ink-400">Dafür fehlt Ihnen das Recht „Freigaben erteilen“.</p>
            )}
            {/* Bleibende Rückmeldung: das Formular verschwindet nach dem Markieren */}
            {(batch.status === "submitted" || batch.status === "settled") && <p role="status" className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">Bei der Bank eingereicht.</p>}
          </li>
          <li>
            <strong>3. Rücklastschriften erfassen</strong> – laut Kontoauszug, je Position unten. Die Rechnung wird wieder offen und läuft ins Mahnwesen.
          </li>
          <li>
            <strong>4. Abschließen</strong> – nach Gutschrift: alle übrigen Positionen gelten als eingezogen, Rechnungen als bezahlt, Mandate wechseln auf Folgelastschrift (RCUR).
            {batch.status === "submitted" && editable && <StateForm action={settleBatchAction.bind(null, slug, batch.id)} submit="Einzug abschließen" ghost className="mt-2 space-y-2" confirm="Ist der Betrag auf dem Konto eingegangen?" />}
          </li>
        </ol>
      </Card>

      <Card title="Positionen">
        <table className="w-full text-left text-[15px]">
          <thead className="text-sm text-ink-400"><tr><th className="py-2">Rechnung</th><th>Zahler</th><th>Mandat</th><th>Sequenz</th><th className="text-right">Betrag</th><th className="pl-4">Status</th><th>Rücklastschrift</th></tr></thead>
          <tbody className="divide-y divide-ink-100 align-top dark:divide-white/10">
            {batch.items.map((it) => {
              const i = inv.get(it.invoiceId);
              return (
                <tr key={it.id}>
                  <td className="py-2 font-mono"><Link className="text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/rechnungen/${it.invoiceId}`}>{i?.number ?? "?"}</Link></td>
                  <td>{it.mandate.accountHolder}<span className="block text-sm text-ink-400">IBAN ···{it.mandate.ibanLast4}</span></td>
                  <td className="font-mono text-sm">{it.mandate.mandateRef}</td>
                  <td>{it.sequence}</td>
                  <td className="text-right tabular-nums">{formatCents(it.amountCents)}</td>
                  <td className="pl-4"><Badge tone={ITEM_STATUS[it.status]?.tone ?? "neutral"}>{ITEM_STATUS[it.status]?.label ?? it.status}</Badge>{it.returnReason && <span className="block text-sm text-ink-400">{it.returnReason}</span>}</td>
                  <td>
                    {it.status === "returned" && <p role="status" className="text-sm text-amber-800 dark:text-amber-200">Rücklastschrift erfasst – Rechnung wieder offen.</p>}
                    {editable && it.status !== "returned" && batch.status !== "draft" && (
                      <details>
                        <summary className="cursor-pointer text-sm">Erfassen</summary>
                        <StateForm action={returnItemAction.bind(null, slug, batch.id, it.id)} submit="Rücklastschrift erfassen" ghost className="mt-2 space-y-2">
                          <select name="reason" aria-label="Rückgabegrund" className={inputCls}>
                            {Object.entries(RETURN_REASONS).map(([k, l]) => <option key={k} value={k}>{k} – {l}</option>)}
                          </select>
                          <input name="fee" inputMode="decimal" placeholder="Bankgebühr in € (optional)" aria-label="Bankgebühr in Euro" className={inputCls} />
                        </StateForm>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
