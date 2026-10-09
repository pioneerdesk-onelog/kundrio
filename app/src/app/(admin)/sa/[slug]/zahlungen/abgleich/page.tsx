import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { formatCents } from "@/lib/invoice";
import { liveAllowed } from "@/lib/payments/registry";
import { SUGGEST_PREFIX } from "@/lib/payments/reconcile/service";
import { Badge, Card, Empty, PageHeader, inputCls, labelCls } from "@/components/ui";
import { PayForm } from "@/components/payments/forms";
import { SOURCE_LABEL, TX_STATUS } from "@/components/payments/labels";
import { confirmSuggestionsAction, connectRevolutAction, ignoreAction, importCamtAction, manualMatchAction, rematchAction, syncBankAction, unmatchAction } from "../actions";

export const dynamic = "force-dynamic";

const BULK = "bulk-confirm";

export default async function ReconcilePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ansicht?: string }> }) {
  const { slug } = await params;
  const { ansicht } = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const editable = can(access, "invoices", "edit");
  const manage = editable && hasSpecial(access, "manage_keys") && hasSpecial(access, "manage_settings");

  const [accounts, suggested, unmatched, matched, counts] = await Promise.all([
    db.bankAccount.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: "asc" } }),
    db.bankTransaction.findMany({ where: { workspaceId: ws.id, status: "suggested" }, orderBy: [{ matchScore: "desc" }, { bookingDate: "desc" }], take: 200 }),
    db.bankTransaction.findMany({ where: { workspaceId: ws.id, status: "unmatched", ...(ansicht === "alle" ? {} : { amountCents: { gt: 0 } }) }, orderBy: { bookingDate: "desc" }, take: 200 }),
    db.bankTransaction.findMany({ where: { workspaceId: ws.id, status: { in: ["matched", "ignored"] } }, orderBy: { bookingDate: "desc" }, take: 50 }),
    db.bankTransaction.groupBy({ by: ["status"], where: { workspaceId: ws.id }, _count: true }),
  ]);
  const invIds = [...suggested, ...matched].map((t) => t.matchedInvoiceId).filter((x): x is string => Boolean(x));
  const invoices = await db.invoice.findMany({ where: { id: { in: invIds }, workspaceId: ws.id }, select: { id: true, number: true, grossCents: true, buyerName: true, status: true } });
  const inv = new Map(invoices.map((i) => [i.id, i]));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  const InvoiceLink = ({ id }: { id: string | null }) => {
    const i = id ? inv.get(id) : undefined;
    return i ? (
      <span>
        <Link className="font-mono text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/rechnungen/${i.id}`}>{i.number}</Link>
        <span className="block text-sm text-ink-400">{i.buyerName ?? ""} · {formatCents(i.grossCents)}</span>
      </span>
    ) : (
      <span>–</span>
    );
  };

  const TxCell = ({ t }: { t: (typeof unmatched)[number] }) => (
    <>
      <td className="py-2 whitespace-nowrap">{formatDate(t.bookingDate)}<span className="block text-xs text-ink-400">{accName.get(t.accountId)}</span></td>
      <td className={`text-right tabular-nums ${t.amountCents < 0 ? "text-red-700 dark:text-red-300" : ""}`}>{formatCents(t.amountCents, t.currency)}</td>
      <td className="max-w-md">
        <span className="font-medium">{t.counterparty ?? "–"}</span>
        {t.counterpartyIbanLast4 && <span className="text-sm text-ink-400"> · IBAN …{t.counterpartyIbanLast4}</span>}
        <span className="block break-words text-sm text-ink-600 dark:text-ink-200">{t.remittance ?? ""}</span>
        {t.endToEndId && <span className="block font-mono text-xs text-ink-400">E2E {t.endToEndId}</span>}
      </td>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kontoabgleich"
        description="Kontoumsätze importieren und Rechnungen zuordnen. Automatisch zugeordnet wird nur bei exakter eigener Kennung (Lastschrift-EndToEndId, Zahlungs-ID); alles andere sind Vorschläge, die Sie bestätigen."
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="accent">{count("suggested")} Vorschläge</Badge>
        <Badge>{count("unmatched")} offen</Badge>
        <Badge tone="ok">{count("matched")} zugeordnet</Badge>
        <Badge>{count("ignored")} ignoriert</Badge>
      </div>

      <Card title="Bankkonten">
        {accounts.length === 0 ? (
          <Empty>Noch kein Konto. Laden Sie einen CAMT-Auszug hoch oder verbinden Sie Revolut Business.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{a.name} {a.ibanLast4 && <span className="text-sm text-ink-400">IBAN …{a.ibanLast4}</span>}</p>
                  <p className="text-sm text-ink-600 dark:text-ink-200">{SOURCE_LABEL[a.source] ?? a.source} · zuletzt {a.lastSyncAt ? formatDate(a.lastSyncAt, true) : "nie"}</p>
                  {a.lastError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{a.lastError}</p>}
                </div>
                {editable && a.source === "revolut_business" && <PayForm action={syncBankAction.bind(null, slug, a.id)} submit="Jetzt abrufen" tone="ghost" className="space-y-1" />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editable && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Kontoauszug importieren (CAMT)">
            <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">camt.053 (Tagesauszug) oder camt.054 (Avis), Versionen .001.02 bis .001.08 – aus dem Online-Banking als XML exportieren. Doppelte Umsätze werden erkannt.</p>
            <PayForm action={importCamtAction.bind(null, slug)} submit="Importieren und zuordnen">
              <div>
                <label htmlFor="camt-file" className={labelCls}>Datei (XML)</label>
                <input id="camt-file" name="file" type="file" accept=".xml,application/xml,text/xml" required className={inputCls} />
              </div>
              {accounts.some((a) => a.source === "camt") && (
                <div>
                  <label htmlFor="camt-account" className={labelCls}>Konto</label>
                  <select id="camt-account" name="accountId" className={inputCls}>
                    <option value="">automatisch (nach IBAN)</option>
                    {accounts.filter((a) => a.source === "camt").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
            </PayForm>
          </Card>

          <Card title="Revolut Business verbinden">
            {manage ? (
              <details>
                <summary className="cursor-pointer text-[15px]">Anleitung und Formular</summary>
                <ol className="my-3 list-decimal space-y-1 pl-5 text-sm text-ink-600 dark:text-ink-200">
                  <li>Schlüsselpaar erzeugen: <code>openssl genrsa -out privatecert.pem 2048</code> und <code>openssl req -new -x509 -key privatecert.pem -out publiccert.cer -days 1825</code>.</li>
                  <li>Revolut Business (bzw. Sandbox) → Einstellungen → APIs → Business API: Zertifikat <code>publiccert.cer</code> hochladen, OAuth-Redirect-URI eintragen, Client-ID notieren.</li>
                  <li>Zugriff erlauben („Enable API access“) – danach steht in der Adresszeile <code>?code=…</code>. Den Code unten eintragen (nur wenige Minuten gültig).</li>
                  <li>Es wird nur gelesen (Konten, Umsätze). Abruf täglich um 05:00 UTC oder per „Jetzt abrufen“.</li>
                </ol>
                <PayForm action={connectRevolutAction.bind(null, slug)} submit="Verbinden">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label htmlFor="rb-name" className={labelCls}>Bezeichnung</label><input id="rb-name" name="name" placeholder="Revolut Business EUR" className={inputCls} /></div>
                    <div>
                      <label htmlFor="rb-mode" className={labelCls}>Umgebung</label>
                      <select id="rb-mode" name="mode" className={inputCls}>
                        <option value="test">Sandbox</option>
                        <option value="live" disabled={!liveAllowed()}>Produktion{liveAllowed() ? "" : " (nicht freigeschaltet)"}</option>
                      </select>
                    </div>
                    <div><label htmlFor="rb-client" className={labelCls}>Client-ID *</label><input id="rb-client" name="clientId" required autoComplete="off" className={inputCls} /></div>
                    <div><label htmlFor="rb-issuer" className={labelCls}>Domain der Redirect-URI (iss) *</label><input id="rb-issuer" name="issuer" required placeholder="kundrio.de" className={inputCls} /></div>
                    <div className="sm:col-span-2"><label htmlFor="rb-key" className={labelCls}>Privater Schlüssel (privatecert.pem) *</label><textarea id="rb-key" name="privateKey" required rows={4} autoComplete="off" className={`${inputCls} font-mono text-xs`} placeholder="-----BEGIN PRIVATE KEY-----" /></div>
                    <div><label htmlFor="rb-code" className={labelCls}>Autorisierungscode</label><input id="rb-code" name="code" autoComplete="off" className={inputCls} /></div>
                    <div><label htmlFor="rb-refresh" className={labelCls}>oder Refresh-Token</label><input id="rb-refresh" name="refreshToken" type="password" autoComplete="off" className={inputCls} /></div>
                  </div>
                </PayForm>
              </details>
            ) : (
              <p className="text-[15px] text-ink-600 dark:text-ink-200">Dafür sind die Rechte „Rechnungen bearbeiten“, „API-, MCP- und Webhook-Zugänge verwalten“ und „Einstellungen & Branding“ nötig (Standard: Rolle Admin), weil ein dauerhafter Bankzugang hinterlegt wird.</p>
            )}
          </Card>
        </div>
      )}

      <Card title={`Vorschläge (${suggested.length})`}>
        {suggested.length === 0 ? (
          <Empty>Keine offenen Vorschläge.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead className="text-sm text-ink-400"><tr>{editable && <th className="py-2"><span className="sr-only">Auswählen</span></th>}<th className="py-2">Datum</th><th className="text-right">Betrag</th><th>Umsatz</th><th>Rechnung</th><th>Bewertung</th>{editable && <th>Aktion</th>}</tr></thead>
                <tbody className="divide-y divide-ink-100 align-top dark:divide-white/10">
                  {suggested.map((t) => (
                    <tr key={t.id}>
                      {editable && <td className="py-2 pr-2"><input type="checkbox" name="ids" value={t.id} form={BULK} aria-label={`Vorschlag ${formatCents(t.amountCents)} vom ${formatDate(t.bookingDate)} auswählen`} /></td>}
                      <TxCell t={t} />
                      <td><InvoiceLink id={t.matchedInvoiceId} /></td>
                      <td className="max-w-xs">
                        <Badge tone={(t.matchScore ?? 0) >= 85 ? "ok" : (t.matchScore ?? 0) >= 60 ? "accent" : "warn"}>{Math.round(t.matchScore ?? 0)} %</Badge>
                        <ul className="mt-1 list-disc pl-4 text-sm text-ink-600 dark:text-ink-200">
                          {(t.matchedBy ?? "").replace(SUGGEST_PREFIX, "").split(" · ").filter(Boolean).map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      </td>
                      {editable && (
                        <td className="space-y-2">
                          <PayForm action={confirmSuggestionsAction.bind(null, slug)} submit="Bestätigen" className="space-y-1"><input type="hidden" name="ids" value={t.id} /></PayForm>
                          <PayForm action={ignoreAction.bind(null, slug, t.id)} submit="Ignorieren" tone="ghost" className="space-y-1" />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {/* Formular bleibt auch bei leerer Liste stehen, damit die Rückmeldung nach dem Bestätigen sichtbar bleibt */}
        {editable && <PayForm id={BULK} action={confirmSuggestionsAction.bind(null, slug)} submit="Ausgewählte bestätigen" hideSubmit={suggested.length === 0} className="mt-4 space-y-2" confirm="Ausgewählte Zuordnungen bestätigen? Vollständig bezahlte Rechnungen werden als bezahlt markiert." />}
      </Card>

      <Card title={`Ohne Zuordnung (${unmatched.length}${unmatched.length === 200 ? "+" : ""})`}>
        {/* div statt p: darin steht ein Formular (form in p ist ungültiges HTML → Hydrationsfehler) */}
        <div className="mb-3 text-sm">
          {ansicht === "alle" ? <Link className="text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/zahlungen/abgleich`}>Nur Eingänge zeigen</Link> : <Link className="text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/zahlungen/abgleich?ansicht=alle`}>Auch Ausgänge zeigen</Link>}
          {editable && <span className="ml-4 inline-block align-middle"><PayForm action={rematchAction.bind(null, slug)} submit="Neu bewerten" tone="ghost" className="inline-flex items-center gap-2" /></span>}
        </div>
        {unmatched.length === 0 ? (
          <Empty>Alles zugeordnet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead className="text-sm text-ink-400"><tr><th className="py-2">Datum</th><th className="text-right">Betrag</th><th>Umsatz</th>{editable && <th>Zuordnen</th>}</tr></thead>
              <tbody className="divide-y divide-ink-100 align-top dark:divide-white/10">
                {unmatched.map((t) => (
                  <tr key={t.id}>
                    <TxCell t={t} />
                    {editable && (
                      <td className="space-y-2">
                        <PayForm action={manualMatchAction.bind(null, slug, t.id)} submit="Zuordnen" tone="ghost" className="flex flex-wrap items-center gap-2">
                          <input name="number" aria-label="Rechnungsnummer" placeholder="RE-…" className={`${inputCls} w-36`} />
                        </PayForm>
                        <PayForm action={ignoreAction.bind(null, slug, t.id)} submit="Ignorieren" tone="ghost" className="space-y-1" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Zuletzt zugeordnet / ignoriert">
        {matched.length === 0 ? (
          <Empty>Noch nichts.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead className="text-sm text-ink-400"><tr><th className="py-2">Datum</th><th className="text-right">Betrag</th><th>Umsatz</th><th>Rechnung</th><th>Status</th>{editable && <th>Aktion</th>}</tr></thead>
              <tbody className="divide-y divide-ink-100 align-top dark:divide-white/10">
                {matched.map((t) => (
                  <tr key={t.id}>
                    <TxCell t={t} />
                    <td><InvoiceLink id={t.matchedInvoiceId} /></td>
                    <td><Badge tone={TX_STATUS[t.status]?.tone ?? "neutral"}>{TX_STATUS[t.status]?.label ?? t.status}</Badge><span className="block text-xs text-ink-400">{t.matchedBy?.startsWith("auto:") ? "automatisch" : ""}</span></td>
                    {editable && <td><PayForm action={unmatchAction.bind(null, slug, t.id)} submit="Lösen" tone="ghost" className="space-y-1" confirm="Zuordnung lösen? Eine dadurch nicht mehr vollständig bezahlte Rechnung wird wieder offen." /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
