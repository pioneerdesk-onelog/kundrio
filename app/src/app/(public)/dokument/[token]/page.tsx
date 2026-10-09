import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";
import { rateLimitAsync } from "@/lib/ratelimit";
import { verifyAcceptToken } from "@/lib/documents/accept-token";
import { acceptQuote, DocumentFlowError } from "@/lib/documents/flow";
import { computeTotals, formatCents, lineNetCents, parseItems, UNIT_LABEL } from "@/lib/invoice";
import { btnCls, inputCls, labelCls } from "@/components/ui";

export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "UTC" }).format(d) : "");

async function accept(token: string, formData: FormData) {
  "use server";
  const ip = clientIp(await headers());
  if (!(await rateLimitAsync(`doc-accept:${ip}`, 10, 10 * 60_000))) redirect(`/dokument/${token}?status=limit`);
  const v = verifyAcceptToken(token);
  if (!v) redirect(`/dokument/${token}?status=ungueltig`);
  const inv = await db.invoice.findFirst({ where: { id: v.invoiceId, kind: "QUOTE" }, select: { workspaceId: true } });
  if (!inv) redirect(`/dokument/${token}?status=ungueltig`);
  if (formData.get("confirm") !== "on") redirect(`/dokument/${token}?status=bestaetigen`);
  const ref = String(formData.get("customerOrderRef") ?? "").trim().slice(0, 100);
  try {
    await acceptQuote(inv.workspaceId, v.invoiceId, `customer:${v.invoiceId}`, { customerOrderRef: ref || null, via: "customer" });
  } catch (e) {
    if (e instanceof DocumentFlowError) redirect(`/dokument/${token}?status=nicht-moeglich`);
    throw e;
  }
  redirect(`/dokument/${token}?status=angenommen`);
}

// Öffentliche Online-Annahme eines Angebots über einen signierten Link (kein Login).
// Zeigt nur Daten dieses einen Angebots; erst der bestätigte Klick nimmt an.
export default async function AcceptPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ status?: string }> }) {
  const { token } = await params;
  const { status } = await searchParams;
  const v = verifyAcceptToken(token);
  const inv = v ? await db.invoice.findFirst({ where: { id: v.invoiceId, kind: "QUOTE" }, include: { workspace: true } }) : null;
  const box = "mx-auto max-w-2xl rounded-lg bg-white p-6 shadow-sm dark:bg-ink-900";

  if (!v || !inv || inv.status === "CANCELLED") {
    return (
      <div className={box}>
        <h1 className="mb-3 text-xl font-semibold">Angebot nicht verfügbar</h1>
        <p>Dieser Link ist ungültig, abgelaufen oder das Angebot wurde zurückgezogen. Bitte wenden Sie sich an Ihren Ansprechpartner.</p>
      </div>
    );
  }
  const ws = inv.workspace;
  const items = parseItems(inv.items);
  const t = computeTotals(items);
  const accepted = inv.status === "ACCEPTED";
  const expired = inv.dueDate ? inv.dueDate.getTime() + 864e5 < Date.now() : false;

  return (
    <div className={box}>
      <p className="text-sm dark:text-ink-100!" style={{ color: ws.brandPrimary }}>{ws.legalName ?? ws.name}</p>
      <h1 className="mb-1 font-display text-2xl">Angebot {inv.number}</h1>
      <p className="mb-5 text-[15px] text-ink-600 dark:text-ink-200">
        für {inv.buyerName} · vom {day(inv.issueDate)}{inv.dueDate ? ` · gültig bis ${day(inv.dueDate)}` : ""}
      </p>

      <table className="mb-4 w-full text-left text-[15px]">
        <thead className="text-sm text-ink-400"><tr><th className="py-1">Leistung</th><th className="text-right">Menge</th><th className="text-right">Netto</th></tr></thead>
        <tbody className="divide-y divide-ink-100 dark:divide-white/10">
          {items.map((it, i) => (
            <tr key={i}><td className="py-1.5 pr-2">{it.title}</td><td className="text-right tabular-nums">{it.qty.toLocaleString("de-DE")} {UNIT_LABEL[it.unit]}</td><td className="text-right tabular-nums">{formatCents(lineNetCents(it), inv.currency)}</td></tr>
          ))}
        </tbody>
      </table>
      <dl className="mb-6 ml-auto w-64 space-y-1 text-[15px]">
        <div className="flex justify-between"><dt>Netto</dt><dd className="tabular-nums">{formatCents(t.netCents, inv.currency)}</dd></div>
        {t.vatGroups.map((g) => <div key={g.rate} className="flex justify-between text-ink-600 dark:text-ink-200"><dt>USt {g.rate} %</dt><dd className="tabular-nums">{formatCents(g.vatCents, inv.currency)}</dd></div>)}
        <div className="flex justify-between border-t border-ink-200 pt-1 font-semibold"><dt>Gesamt</dt><dd className="tabular-nums">{formatCents(t.grossCents, inv.currency)}</dd></div>
      </dl>

      {status === "angenommen" || accepted ? (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
          Vielen Dank – das Angebot ist angenommen. {ws.legalName ?? ws.name} meldet sich mit der Auftragsbestätigung.
        </p>
      ) : expired ? (
        <p className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">Die Gültigkeit dieses Angebots ist abgelaufen. Bitte fordern Sie ein aktuelles Angebot an.</p>
      ) : (
        <form action={accept.bind(null, token)} className="space-y-3">
          <div>
            <label htmlFor="ref" className={labelCls}>Ihre Bestellnummer (optional)</label>
            <input id="ref" name="customerOrderRef" maxLength={100} className={inputCls} />
          </div>
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" name="confirm" required className="mt-1" />
            <span>Ich nehme das Angebot {inv.number} über {formatCents(t.grossCents, inv.currency)} (brutto) verbindlich an und bin dazu berechtigt.</span>
          </label>
          {status === "bestaetigen" && <p role="alert" className="text-red-700">Bitte bestätigen Sie die Annahme mit dem Häkchen.</p>}
          {status === "limit" && <p role="alert" className="text-red-700">Zu viele Versuche. Bitte später erneut versuchen.</p>}
          {status === "nicht-moeglich" && <p role="alert" className="text-red-700">Die Annahme ist nicht mehr möglich. Bitte wenden Sie sich an Ihren Ansprechpartner.</p>}
          <button className={btnCls}>Angebot verbindlich annehmen</button>
        </form>
      )}
      <p className="mt-6 text-xs text-ink-400">{[ws.legalName ?? ws.name, ws.legalAddress?.split(/\r?\n/).join(", "), ws.vatId ? `USt-IdNr. ${ws.vatId}` : ""].filter(Boolean).join(" · ")}</p>
    </div>
  );
}
