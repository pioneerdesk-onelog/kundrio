import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";
import { rateLimitAsync } from "@/lib/ratelimit";
import { computeTotals, formatCents, parseItems, STATUS_LABEL } from "@/lib/invoice";
import { INTERVAL_LABEL, isInterval } from "@/lib/billing/periods";
import { contactForPortalToken, portalCancel } from "@/lib/billing/portal";
import { BillingError } from "@/lib/billing/service";
import { btnCls, inputCls, labelCls } from "@/components/ui";
import { PayButton } from "@/components/payments/PayButton";

export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "UTC" }).format(d) : "–");

async function cancel(token: string, subId: string, fd: FormData) {
  "use server";
  const ip = clientIp(await headers());
  if (!(await rateLimitAsync(`portal-cancel:${ip}`, 10, 10 * 60_000))) redirect(`/kundenportal/${token}?kuendigen=${subId}&status=limit`);
  const name = String(fd.get("name") ?? "").trim().slice(0, 200);
  const email = String(fd.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const kind = fd.get("kind") === "ausserordentlich" ? "ausserordentlich" : "ordentlich";
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 1000);
  const wishDate = String(fd.get("wishDate") ?? "").slice(0, 10);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (kind === "ausserordentlich" && !reason)) redirect(`/kundenportal/${token}?kuendigen=${subId}&status=angaben`);
  let r;
  try {
    r = await portalCancel(token, subId, { name, email, kind, reason, wishDate });
  } catch (e) {
    if (e instanceof BillingError) redirect(`/kundenportal/${token}?status=ungueltig`);
    throw e;
  }
  const q = new URLSearchParams({ bestaetigt: subId, am: r.receivedAt.toISOString(), mail: r.mailed ? "1" : "0" });
  redirect(`/kundenportal/${token}?${q}`);
}

// Kundenportal (ohne Login, signierter Link je Kontakt): Abos, Rechnungen, Kündigungsbutton nach § 312k BGB.
export default async function PortalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ kuendigen?: string; bestaetigt?: string; am?: string; mail?: string; status?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const contact = await contactForPortalToken(token);
  const box = "mx-auto max-w-3xl rounded-lg bg-white p-6 shadow-sm dark:bg-ink-900";
  if (!contact || sp.status === "ungueltig") {
    return (
      <div className={box}>
        <h1 className="mb-3 text-xl font-semibold">Link ungültig</h1>
        <p>Dieser Link zum Kundenportal ist ungültig oder wurde ersetzt. Bitte wenden Sie sich an Ihren Ansprechpartner.</p>
      </div>
    );
  }
  const ws = contact.workspace;
  const [subs, invoices] = await Promise.all([
    db.subscription.findMany({ where: { workspaceId: ws.id, contactId: contact.id }, orderBy: { startDate: "desc" } }),
    db.invoice.findMany({ where: { workspaceId: ws.id, contactId: contact.id, kind: "INVOICE", status: { in: ["SENT", "PAID"] } }, orderBy: { issueDate: "desc" }, take: 100 }),
  ]);
  const confirming = sp.kuendigen ? subs.find((s) => s.id === sp.kuendigen && (s.status === "active" || s.status === "paused")) : undefined;
  const confirmed = sp.bestaetigt ? subs.find((s) => s.id === sp.bestaetigt) : undefined;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const subTitle = (s: (typeof subs)[number]) => parseItems(s.items).map((i) => i.title).join(", ");

  return (
    <div className={`${box} space-y-8`}>
      <header>
        <p className="text-sm dark:text-ink-100!" style={{ color: ws.brandPrimary }}>{ws.legalName ?? ws.name}</p>
        <h1 className="font-display text-2xl">Ihr Kundenportal</h1>
        <p className="text-[15px] text-ink-600 dark:text-ink-200">{[name, contact.company].filter(Boolean).join(" · ")}</p>
      </header>

      {confirmed && (
        <section role="status" className="rounded-md bg-emerald-50 p-4 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
          <h2 className="mb-1 font-semibold">Ihre Kündigung ist eingegangen</h2>
          <p>
            Eingang: {sp.am ? new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(sp.am)) : "–"} Uhr · Vertrag: {subTitle(confirmed)} ·
            endet zum <strong>{day(confirmed.endDate)}</strong>.
          </p>
          <p className="mt-1 text-sm">{sp.mail === "1" ? "Eine Bestätigung haben wir Ihnen per E-Mail geschickt." : "Die Bestätigungs-E-Mail konnte nicht sofort versendet werden – wir senden sie Ihnen manuell zu. Bitte speichern oder drucken Sie diese Seite."}</p>
        </section>
      )}

      {confirming ? (
        <section aria-labelledby="k-title" className="space-y-4">
          <h2 id="k-title" className="text-xl font-semibold">Kündigung bestätigen</h2>
          <p className="text-[15px]">Vertrag: <strong>{subTitle(confirming)}</strong> ({isInterval(confirming.interval) ? INTERVAL_LABEL[confirming.interval] : confirming.interval}, seit {day(confirming.startDate)})</p>
          <form action={cancel.bind(null, token, confirming.id)} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className={labelCls}>Ihr Name</label>
                <input id="name" name="name" required defaultValue={name} maxLength={200} className={inputCls} autoComplete="name" />
              </div>
              <div>
                <label htmlFor="email" className={labelCls}>E-Mail für die Bestätigung</label>
                <input id="email" name="email" type="email" required defaultValue={contact.email ?? ""} className={inputCls} autoComplete="email" />
              </div>
            </div>
            <fieldset>
              <legend className={labelCls}>Art der Kündigung</legend>
              <label className="mr-4 inline-flex items-center gap-2"><input type="radio" name="kind" value="ordentlich" defaultChecked /> ordentlich</label>
              <label className="inline-flex items-center gap-2"><input type="radio" name="kind" value="ausserordentlich" /> außerordentlich</label>
            </fieldset>
            <div>
              <label htmlFor="reason" className={labelCls}>Grund (nur bei außerordentlicher Kündigung erforderlich)</label>
              <textarea id="reason" name="reason" rows={3} maxLength={1000} className={inputCls} />
            </div>
            <div>
              <label htmlFor="wishDate" className={labelCls}>Gewünschter Zeitpunkt (leer = nächstmöglich)</label>
              <input id="wishDate" name="wishDate" type="date" className={inputCls} />
            </div>
            {sp.status === "angaben" && <p role="alert" className="text-red-700">Bitte Name und E-Mail angeben, bei außerordentlicher Kündigung auch den Grund.</p>}
            {sp.status === "limit" && <p role="alert" className="text-red-700">Zu viele Versuche. Bitte später erneut versuchen.</p>}
            <button className={btnCls}>Jetzt kündigen</button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="v-title">
        <h2 id="v-title" className="mb-3 text-xl font-semibold">Ihre Verträge</h2>
        {subs.length === 0 ? <p>Keine Verträge vorhanden.</p> : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {subs.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{subTitle(s)}</p>
                  <p className="text-sm text-ink-600 dark:text-ink-200">
                    {formatCents(computeTotals(parseItems(s.items)).grossCents)} {isInterval(s.interval) ? INTERVAL_LABEL[s.interval] : ""} ·{" "}
                    {s.status === "active" ? `aktiv, nächste Abrechnung ${day(s.nextBillingDate)}` : s.status === "paused" ? "pausiert" : s.status === "cancelled" ? `gekündigt, endet ${day(s.endDate)}` : "beendet"}
                  </p>
                </div>
                {(s.status === "active" || s.status === "paused") && s.id !== confirming?.id && (
                  <a href={`/kundenportal/${token}?kuendigen=${s.id}#k-title`} className={btnCls}>Vertrag hier kündigen</a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="r-title">
        <h2 id="r-title" className="mb-3 text-xl font-semibold">Rechnungen</h2>
        {invoices.length === 0 ? <p>Noch keine Rechnungen.</p> : (
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-ink-400"><tr><th className="py-1">Nummer</th><th>Datum</th><th className="text-right">Betrag</th><th className="pl-4">Status</th><th><span className="sr-only">Download</span></th></tr></thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="py-1.5 font-mono">{i.number}</td>
                  <td>{day(i.issueDate)}</td>
                  <td className="text-right tabular-nums">{formatCents(i.grossCents, i.currency)}</td>
                  <td className="pl-4">{STATUS_LABEL[i.status] ?? i.status}</td>
                  <td className="text-right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-3">
                      {i.status === "SENT" && <PayButton workspaceId={ws.id} invoiceId={i.id} variant="customer" label="Bezahlen" />}
                      <a className="text-accent-500 hover:underline dark:text-accent-100" href={`/kundenportal/${token}/rechnung/${i.id}`} aria-label={`Rechnung ${i.number} als PDF`}>PDF</a>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-xs text-ink-400">{[ws.legalName ?? ws.name, ws.legalAddress?.split(/\r?\n/).join(", "), ws.vatId ? `USt-IdNr. ${ws.vatId}` : ""].filter(Boolean).join(" · ")}</p>
    </div>
  );
}
