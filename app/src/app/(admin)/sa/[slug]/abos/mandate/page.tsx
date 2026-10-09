import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { isoDay } from "@/lib/billing/periods";
import { Badge, Card, Empty, PageHeader, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { StateForm } from "@/components/billing/forms";
import { MANDATE_STATUS } from "@/components/billing/labels";
import { createMandateAction, revokeMandateAction, uploadMandateProof } from "../actions";

export const dynamic = "force-dynamic";

export default async function MandatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const editable = can(access, "invoices", "edit");
  const [mandates, contacts] = await Promise.all([
    db.sepaMandate.findMany({ where: { workspaceId: ws.id }, include: { contact: true }, orderBy: { createdAt: "desc" }, take: 500 }),
    editable ? db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), orderBy: [{ company: "asc" }, { lastName: "asc" }], take: 1000, select: { id: true, firstName: true, lastName: true, company: true, email: true } }) : [],
  ]);
  const cname = (c: { firstName: string | null; lastName: string | null; company: string | null; email: string | null }) => c.company || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "–";

  return (
    <div className="space-y-6">
      <PageHeader title="SEPA-Mandate" description="Lastschriftmandate der Kunden. Die IBAN wird verschlüsselt gespeichert und nur mit den letzten 4 Stellen angezeigt." />
      {!ws.creditorId && (
        <p role="alert" className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          Es ist noch keine Gläubiger-ID hinterlegt (Einstellungen). Ohne sie sind Mandats-PDF und Lastschrift-Stapel nicht möglich.
        </p>
      )}
      {editable && (
        <Card title="Mandat erfassen">
          <StateForm action={createMandateAction.bind(null, slug)} submit="Mandat anlegen">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="m-contact" className={labelCls}>Kontakt</label>
                <select id="m-contact" name="contactId" required className={inputCls}>
                  <option value="">– wählen –</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{cname(c)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="m-holder" className={labelCls}>Kontoinhaber</label>
                <input id="m-holder" name="accountHolder" required maxLength={70} className={inputCls} />
              </div>
              <div>
                <label htmlFor="m-iban" className={labelCls}>IBAN</label>
                <input id="m-iban" name="iban" required autoComplete="off" spellCheck={false} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label htmlFor="m-bic" className={labelCls}>BIC (optional, im SEPA-Raum nicht nötig)</label>
                <input id="m-bic" name="bic" maxLength={11} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label htmlFor="m-scheme" className={labelCls}>Verfahren</label>
                <select id="m-scheme" name="scheme" className={inputCls}>
                  <option value="CORE">SEPA-Basislastschrift (CORE)</option>
                  <option value="B1">SEPA-Firmenlastschrift (B2B)</option>
                </select>
              </div>
              <div>
                <label htmlFor="m-signed" className={labelCls}>Unterschrieben am</label>
                <input id="m-signed" name="signedAt" type="date" required defaultValue={isoDay(new Date())} className={inputCls} />
              </div>
            </div>
            <p className="text-sm text-ink-400 dark:text-ink-200">Die Mandatsreferenz wird automatisch vergeben. Danach das Mandat als PDF erzeugen, unterschreiben lassen und den Nachweis hochladen.</p>
          </StateForm>
        </Card>
      )}
      <Card title="Mandate">
        {mandates.length === 0 ? <Empty>Noch keine Mandate.</Empty> : (
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-ink-400"><tr><th className="py-2">Referenz</th><th>Kunde</th><th>IBAN</th><th>Verfahren</th><th>Unterschrieben</th><th>Zuletzt genutzt</th><th>Status</th><th>Nachweis</th></tr></thead>
            <tbody className="divide-y divide-ink-100 align-top dark:divide-white/10">
              {mandates.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 font-mono">{m.mandateRef}</td>
                  <td>{cname(m.contact)}<span className="block text-sm text-ink-400">{m.accountHolder}</span></td>
                  <td className="font-mono">···{m.ibanLast4}</td>
                  <td>{m.scheme === "B1" ? "B2B" : "Basis"} · {m.sequence}</td>
                  <td>{formatDate(m.signedAt)}</td>
                  <td>{formatDate(m.lastUsedAt)}</td>
                  <td><Badge tone={MANDATE_STATUS[m.status]?.tone ?? "neutral"}>{MANDATE_STATUS[m.status]?.label ?? m.status}</Badge></td>
                  <td className="space-y-2">
                    {ws.creditorId && <Link className="text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/abos/mandate/${m.id}/pdf`}>Mandat (PDF)</Link>}
                    {m.proofFileId && <Link className="block text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/abos/mandate/${m.id}/nachweis`}>Nachweis</Link>}
                    {editable && (
                      <details>
                        <summary className="cursor-pointer text-sm">{m.proofFileId ? "Nachweis ersetzen" : "Nachweis hochladen"}</summary>
                        <StateForm action={uploadMandateProof.bind(null, slug, m.id)} submit="Hochladen" ghost className="mt-2 space-y-2">
                          <input type="file" name="file" accept="application/pdf,image/png,image/jpeg" aria-label="Unterschriebenes Mandat" className="text-sm" />
                        </StateForm>
                      </details>
                    )}
                    {editable && m.status === "active" && (
                      <form action={revokeMandateAction.bind(null, slug, m.id)}><button className={btnGhostCls}>Widerrufen</button></form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-4 text-sm text-ink-400 dark:text-ink-200">Ein Mandat verfällt, wenn 36 Monate lang keine Lastschrift damit eingezogen wurde. Das prüft der nächtliche Abrechnungslauf.</p>
      </Card>
    </div>
  );
}
