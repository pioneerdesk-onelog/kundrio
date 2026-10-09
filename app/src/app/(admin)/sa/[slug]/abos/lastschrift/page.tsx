import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { formatCents } from "@/lib/invoice";
import { collectibleInvoices } from "@/lib/billing/service";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { StateForm } from "@/components/billing/forms";
import { BATCH_STATUS } from "@/components/billing/labels";
import { createBatchAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DirectDebitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const editable = can(access, "invoices", "edit");
  const [open, batches] = await Promise.all([
    collectibleInvoices(ws.id),
    db.directDebitBatch.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const ready = !!ws.creditorId && !!ws.iban;

  return (
    <div className="space-y-6">
      <PageHeader title="Lastschrift" description="Versendete Lastschrift-Rechnungen zu einem Stapel bündeln, als pain.008-XML bei der Bank einreichen, Einzug und Rücklastschriften erfassen." />
      {!ready && (
        <p role="alert" className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          Für Lastschriften werden Gläubiger-ID und die eigene IBAN benötigt (Einstellungen → Firmendaten).
        </p>
      )}
      <Card title="Einziehbare Rechnungen">
        {open.length === 0 ? <Empty>Keine versendeten Lastschrift-Rechnungen offen. Rechnungsentwürfe müssen zuerst versendet werden (Vorabankündigung).</Empty> : (
          <StateForm action={createBatchAction.bind(null, slug)} submit="Stapel erstellen">
            <table className="w-full text-left text-[15px]">
              <thead className="text-sm text-ink-400"><tr><th className="py-2"><span className="sr-only">Auswahl</span></th><th>Rechnung</th><th>Kunde</th><th>Fällig</th><th className="text-right">Betrag</th><th className="pl-4">Mandat</th></tr></thead>
              <tbody className="divide-y divide-ink-100 dark:divide-white/10">
                {open.map(({ invoice: i, mandate: m }) => (
                  <tr key={i.id}>
                    <td className="py-2"><input type="checkbox" name="invoiceId" value={i.id} defaultChecked={!!m} disabled={!m || !editable} aria-label={`Rechnung ${i.number} einziehen`} /></td>
                    <td className="font-mono"><Link className="text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/rechnungen/${i.id}`}>{i.number}</Link></td>
                    <td>{i.buyerName}</td>
                    <td>{formatDate(i.dueDate)}</td>
                    <td className="text-right tabular-nums">{formatCents(i.grossCents)}</td>
                    <td className="pl-4">{m ? `${m.mandateRef} · ${m.sequence}` : <span className="text-red-700 dark:text-red-300">kein aktives Mandat</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm text-ink-400 dark:text-ink-200">
              Das Einzugsdatum wird automatisch berechnet: frühestens 14 Tage nach der Vorabankündigung (Rechnungsdatum), mindestens einen TARGET2-Bankarbeitstag nach heute, nie vor der Fälligkeit.
            </p>
          </StateForm>
        )}
      </Card>
      <Card title="Stapel">
        {batches.length === 0 ? <Empty>Noch keine Stapel.</Empty> : (
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-ink-400"><tr><th className="py-2">Nachricht</th><th>Erstellt</th><th>Einzug am</th><th className="text-right">Anzahl</th><th className="text-right">Summe</th><th className="pl-4">Status</th></tr></thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="py-2 font-mono"><Link className="text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/abos/lastschrift/${b.id}`}>{b.messageId}</Link></td>
                  <td>{formatDate(b.createdAt)}</td>
                  <td>{formatDate(b.collectionDate)}</td>
                  <td className="text-right tabular-nums">{b.count}</td>
                  <td className="text-right tabular-nums">{formatCents(b.totalCents)}</td>
                  <td className="pl-4"><Badge tone={BATCH_STATUS[b.status]?.tone ?? "neutral"}>{BATCH_STATUS[b.status]?.label ?? b.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
