import { redirect } from "next/navigation";
import { verifyDoiToken } from "@/lib/b-doi";
import { confirmConsent } from "@/lib/b-consent";
import { btnCls } from "@/components/ui";
import { db } from "@/lib/db";
import { fireTrigger } from "@/lib/automation";

export const dynamic = "force-dynamic";

async function doConfirm(id: string, token: string) {
  "use server";
  const formId = verifyDoiToken(id, token);
  const ok = formId ? await confirmConsent(id, formId) : false;
  if (ok) {
    const c = await db.contact.findUnique({ where: { id }, select: { workspaceId: true } });
    if (c) await fireTrigger(c.workspaceId, "CONSENT_CONFIRMED", { contactId: id, formId: formId ?? undefined });
  }
  redirect(`/c/${id}/${token}?status=${ok ? "fertig" : "ungueltig"}`);
}

// Double-Opt-in-Bestätigung. Erst der Klick auf den Button setzt die Einwilligung.
export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; token: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id, token } = await params;
  const { status } = await searchParams;
  const valid = verifyDoiToken(id, token) !== null;

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow-sm dark:bg-ink-900">
      <h1 className="mb-3 text-lg font-semibold">Anmeldung bestätigen</h1>
      {status === "fertig" ? (
        <p role="status" className="text-sm">Vielen Dank, Ihre Anmeldung ist bestätigt.</p>
      ) : !valid || status === "ungueltig" ? (
        <p className="text-sm">Dieser Bestätigungslink ist ungültig oder abgelaufen.</p>
      ) : (
        <form action={doConfirm.bind(null, id, token)} className="space-y-3">
          <p className="text-sm">Bitte bestätigen Sie, dass Sie E-Mails von uns erhalten möchten.</p>
          <button className={btnCls}>Anmeldung bestätigen</button>
        </form>
      )}
    </div>
  );
}
