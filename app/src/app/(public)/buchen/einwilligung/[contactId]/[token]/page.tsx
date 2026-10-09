import { redirect } from "next/navigation";
import { verifyDoiToken } from "@/lib/b-doi";
import { btnCls } from "@/components/ui";
import { db } from "@/lib/db";
import { fireTrigger } from "@/lib/automation";
import { confirmBookingConsent } from "@/lib/calendar/booking/service";
import { DOI_PREFIX } from "@/lib/calendar/booking/token";

export const dynamic = "force-dynamic";

function bookingKey(contactId: string, token: string) {
  const key = verifyDoiToken(contactId, token);
  return key?.startsWith(DOI_PREFIX) ? key : null;
}

async function doConfirm(contactId: string, token: string) {
  "use server";
  const key = bookingKey(contactId, token);
  const ok = key ? await confirmBookingConsent(contactId, key) : false;
  if (ok) {
    const c = await db.contact.findUnique({ where: { id: contactId }, select: { workspaceId: true } });
    if (c) await fireTrigger(c.workspaceId, "CONSENT_CONFIRMED", { contactId });
  }
  redirect(`/buchen/einwilligung/${contactId}/${token}?status=${ok ? "fertig" : "ungueltig"}`);
}

// Double-Opt-in für die optionale Newsletter-Einwilligung aus einer Online-Buchung. Erst der Klick setzt die Einwilligung.
export default async function BookingConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string; token: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { contactId, token } = await params;
  const { status } = await searchParams;
  const valid = bookingKey(contactId, token) !== null;

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow-sm dark:bg-ink-900">
      <h1 className="mb-3 text-lg font-semibold">E-Mail-Anmeldung bestätigen</h1>
      {status === "fertig" ? (
        <p role="status" className="text-sm">Vielen Dank, Ihre Anmeldung ist bestätigt.</p>
      ) : !valid || status === "ungueltig" ? (
        <p className="text-sm">Dieser Bestätigungslink ist ungültig oder abgelaufen.</p>
      ) : (
        <form action={doConfirm.bind(null, contactId, token)} className="space-y-3">
          <p className="text-sm">Bitte bestätigen Sie, dass Sie Neuigkeiten per E-Mail von uns erhalten möchten. Sie können sich jederzeit abmelden.</p>
          <button className={btnCls}>Anmeldung bestätigen</button>
        </form>
      )}
    </div>
  );
}
