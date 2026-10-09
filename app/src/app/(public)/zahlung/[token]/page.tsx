import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";
import { rateLimitAsync } from "@/lib/ratelimit";
import { formatCents } from "@/lib/invoice";
import { errMessage, log } from "@/lib/log";
import { verifyPayToken } from "@/lib/payments/crypto";
import { ensurePaymentLink, invoiceOpenCents, PaymentsError, syncPayment } from "@/lib/payments/service";
import { btnCls } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rechnung bezahlen", robots: { index: false, follow: false } };

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "UTC" }).format(d) : null);

const MESSAGES: Record<string, string> = {
  limit: "Zu viele Versuche. Bitte warten Sie einige Minuten.",
  fehler: "Die Zahlung konnte gerade nicht gestartet werden. Bitte versuchen Sie es später erneut oder überweisen Sie den Betrag.",
  bezahlt: "Diese Rechnung ist bereits bezahlt.",
};

async function pay(token: string) {
  "use server";
  const ip = clientIp(await headers());
  if (!(await rateLimitAsync(`paylink:${ip}`, 10, 10 * 60_000))) redirect(`/zahlung/${token}?status=limit`);
  const t = verifyPayToken(token);
  if (!t) redirect(`/zahlung/${token}`);
  const inv = await db.invoice.findUnique({ where: { id: t.invoiceId }, select: { workspaceId: true } });
  if (!inv) redirect(`/zahlung/${token}`);
  let url: string;
  try {
    url = (await ensurePaymentLink(inv.workspaceId, t.invoiceId, { actor: "customer:paylink" })).checkoutUrl;
  } catch (e) {
    if (e instanceof PaymentsError && /bezahlt|nichts mehr offen/.test(e.message)) redirect(`/zahlung/${token}?status=bezahlt`);
    log.warn("paylink failed", { error: errMessage(e) });
    redirect(`/zahlung/${token}?status=fehler`);
  }
  // Nur zum Anbieter weiterleiten (https); http nur außerhalb der Produktion (lokale Mock-Server)
  if (!/^https:\/\//.test(url) && !(process.env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url))) redirect(`/zahlung/${token}?status=fehler`);
  redirect(url);
}

// Öffentliche Bezahlseite je Rechnung (signierter Link, ohne Login). Auch Rückkehrseite nach der Zahlung (?r=…).
export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string; status?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const box = "mx-auto max-w-xl rounded-lg bg-white p-6 shadow-sm dark:bg-ink-900";
  const t = verifyPayToken(token);
  const inv = t
    ? await db.invoice.findFirst({ where: { id: t.invoiceId, kind: "INVOICE", status: { not: "DRAFT" } }, include: { workspace: { select: { name: true, legalName: true, brandPrimary: true } } } })
    : null;
  if (!inv) {
    return (
      <main className={box}>
        <h1 className="mb-3 text-xl font-semibold">Link ungültig</h1>
        <p>Dieser Bezahllink ist ungültig. Bitte wenden Sie sich an den Absender der Rechnung.</p>
      </main>
    );
  }

  // Rückkehr vom Anbieter: Status sofort abfragen (Webhook kann später kommen)
  let returning: string | null = null;
  if (sp.r) {
    const ip = clientIp(await headers());
    const last = await db.payment.findFirst({ where: { invoiceId: inv.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
    let status = last?.status ?? null;
    if (last && (await rateLimitAsync(`payreturn:${ip}`, 30, 10 * 60_000))) {
      try {
        status = (await syncPayment(last.id, "customer:return"))?.status ?? status;
      } catch (e) {
        log.warn("payment return sync failed", { error: errMessage(e) });
      }
    }
    returning = status;
  }
  const fresh = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, select: { status: true } });
  const open = await invoiceOpenCents(inv.workspaceId, inv.id);
  const paid = fresh.status === "PAID" || open <= 0;
  const sender = inv.workspace.legalName ?? inv.workspace.name;

  return (
    <main className={`${box} space-y-6`}>
      <header>
        <p className="text-sm dark:text-ink-100!" style={{ color: inv.workspace.brandPrimary }}>{sender}</p>
        <h1 className="font-display text-2xl">Rechnung {inv.number}</h1>
      </header>

      {returning && !paid && (
        <p role="status" className="rounded-md bg-sand-100 p-3 text-[15px] dark:bg-white/10">
          {returning === "paid" || returning === "pending" || returning === "authorized"
            ? "Danke! Ihre Zahlung wird gerade bestätigt – Sie müssen nichts weiter tun."
            : returning === "canceled" || returning === "expired" || returning === "failed"
              ? "Die Zahlung wurde nicht abgeschlossen. Sie können es erneut versuchen."
              : "Ihre Zahlung ist noch nicht abgeschlossen."}
        </p>
      )}
      {sp.status && MESSAGES[sp.status] && !paid && <p role="alert" className="rounded-md bg-amber-50 p-3 text-[15px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">{MESSAGES[sp.status]}</p>}

      {paid ? (
        <section role="status" className="rounded-md bg-emerald-50 p-4 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
          <h2 className="mb-1 font-semibold">Vielen Dank – diese Rechnung ist bezahlt.</h2>
          <p className="text-[15px]">Es ist nichts weiter zu tun.</p>
        </section>
      ) : fresh.status === "CANCELLED" ? (
        <p>Diese Rechnung wurde storniert.</p>
      ) : (
        <section className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-[15px]">
            <dt className="text-ink-600 dark:text-ink-200">Offener Betrag</dt>
            <dd className="text-right text-xl font-semibold tabular-nums">{formatCents(open, inv.currency)}</dd>
            {inv.grossCents !== open && (
              <>
                <dt className="text-ink-600 dark:text-ink-200">Rechnungsbetrag</dt>
                <dd className="text-right tabular-nums">{formatCents(inv.grossCents, inv.currency)}</dd>
              </>
            )}
            {day(inv.dueDate) && (
              <>
                <dt className="text-ink-600 dark:text-ink-200">Fällig am</dt>
                <dd className="text-right">{day(inv.dueDate)}</dd>
              </>
            )}
          </dl>
          <form action={pay.bind(null, token)}>
            <button className={`${btnCls} w-full justify-center`}>Jetzt online bezahlen</button>
          </form>
          <p className="text-sm text-ink-600 dark:text-ink-200">
            Sie werden zur sicheren Bezahlseite unseres Zahlungsdienstleisters weitergeleitet. Alternativ können Sie wie gewohnt überweisen – bitte mit der Rechnungsnummer {inv.number} als Verwendungszweck.
          </p>
        </section>
      )}
    </main>
  );
}
