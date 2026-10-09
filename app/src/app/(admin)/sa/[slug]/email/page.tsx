import Link from "next/link";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { mailAllowlist } from "@/lib/mail";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { btnCls, btnGhostCls, Card, Empty, inputCls, PageHeader } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";
import { sendSingleMail } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Entwurf",
  APPROVED: "Freigegeben",
  SENDING: "Wird versendet",
  SENT: "Versendet",
  FAILED: "Fehlgeschlagen",
};

export default async function EmailPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: FlashParams }) {
  const { slug } = await params;
  const flash = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const mayEdit = can(access, "email", "edit");
  const mode = env.mailMode();
  const allowlist = mailAllowlist();

  const [outbox, campaigns, contacts] = await Promise.all([
    // Postausgang: nur Mails an Kontakte in der eigenen Reichweite bzw. ohne Kontaktbezug
    db.emailMessage.findMany({ where: { workspaceId: ws.id, OR: [{ contactId: null }, { contact: withScope({}, access, "contacts") }] }, orderBy: { createdAt: "desc" }, take: 30, include: { contact: true } }),
    db.campaign.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { recipients: true } } } }),
    db.contact.findMany({
      where: withScope({ workspaceId: ws.id, email: { not: null } }, access, "contacts"),
      orderBy: [{ lastName: "asc" }, { email: "asc" }],
      take: 500,
      select: { id: true, firstName: true, lastName: true, email: true, unsubscribedAt: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="E-Mail">
        <Link href={`/sa/${slug}/email/vorlagen`} className={btnGhostCls}>Vorlagen</Link>
        <Link href={`/sa/${slug}/api`} className={btnGhostCls}>Versandprotokoll &amp; API</Link>
        {mayEdit && <Link href={`/sa/${slug}/email/kampagne/neu`} className={btnCls}>Neue Kampagne</Link>}
      </PageHeader>
      <Flash {...flash} />

      <div
        className={`rounded-md border px-3 py-2 text-sm ${
          mode === "capture"
            ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
            : "border-red-400 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        }`}
      >
        {mode === "capture" ? (
          <>
            Modus <strong>capture</strong>: Alle E-Mails werden lokal abgefangen und nicht zugestellt. Ansehen in{" "}
            <a className="underline" href="http://127.0.0.1:58025" target="_blank" rel="noreferrer">Mailpit</a>.
          </>
        ) : (
          <>
            Modus <strong>live</strong>: E-Mails werden echt zugestellt über {env.smtpHost()}.
            {allowlist && (
              <div className="mt-1">
                <strong>Freigabeliste aktiv:</strong> Nur an {allowlist.join(", ")} wird echt zugestellt; alle anderen Empfänger landen in{" "}
                <a className="underline" href="http://127.0.0.1:58025" target="_blank" rel="noreferrer">Mailpit</a> (Status „captured“).
              </div>
            )}
          </>
        )}
        {!ws.mailFromEmail && (
          <div className="mt-1">
            Keine Absenderadresse hinterlegt – <Link className="underline" href={`/sa/${slug}/einstellungen`}>Einstellungen</Link>.
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Kampagnen">
          {campaigns.length === 0 ? <Empty>Noch keine Kampagnen.</Empty> : (
            <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
              {campaigns.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link className="hover:underline" href={`/sa/${slug}/email/kampagne/${c.id}`}>{c.name}</Link>
                  <span className="text-xs text-ink-400 dark:text-ink-200">
                    {STATUS_LABEL[c.status]}
                    {c._count.recipients > 0 && ` · ${c._count.recipients} Empf.`}
                    {c.sentAt && ` · ${formatDate(c.sentAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {mayEdit && (
        <Card title="Einzelne E-Mail senden">
          {contacts.length === 0 ? <Empty>Keine Kontakte mit E-Mail-Adresse.</Empty> : (
            <form action={sendSingleMail.bind(null, slug)} className="space-y-2">
              <select name="contactId" required className={inputCls} defaultValue="" aria-label="Empfänger">
                <option value="" disabled>Kontakt wählen …</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email} &lt;{c.email}&gt;
                    {c.unsubscribedAt ? " (abgemeldet)" : ""}
                  </option>
                ))}
              </select>
              <input name="subject" placeholder="Betreff" required maxLength={200} className={inputCls} />
              <textarea name="text" placeholder="Nachricht" required rows={6} maxLength={20000} className={inputCls} />
              <p className="text-xs text-ink-400 dark:text-ink-200">Nur für persönliche 1:1-Korrespondenz. Werbung nur per Kampagne an Kontakte mit Einwilligung.</p>
              <button className={btnCls}>Senden</button>
            </form>
          )}
        </Card>
        )}
      </div>

      <Card title="Postausgang (letzte 30)">
        {outbox.length === 0 ? <Empty>Noch keine E-Mails.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-400 dark:text-ink-200">
              <tr><th className="py-1">Datum</th><th>An</th><th>Betreff</th><th>Status</th></tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {outbox.map((m) => (
                <tr key={m.id}>
                  <td className="py-1.5 whitespace-nowrap text-ink-400 dark:text-ink-200">{formatDate(m.createdAt, true)}</td>
                  <td>
                    {m.contact ? <Link className="hover:underline" href={`/sa/${slug}/kontakte/${m.contact.id}`}>{m.toAddr}</Link> : m.toAddr}
                  </td>
                  <td>{m.subject}</td>
                  <td className="text-xs text-ink-400 dark:text-ink-200">{m.direction === "IN" ? "eingehend" : m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Link href={`/sa/${slug}/formulare`} className={btnGhostCls}>Formulare &amp; Anmeldungen</Link>
    </div>
  );
}
