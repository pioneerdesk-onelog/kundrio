import { redirect } from "next/navigation";
import { verifyUnsubscribeToken } from "@/lib/mail";
import { unsubscribeContact } from "@/lib/b-consent";
import { btnCls } from "@/components/ui";

export const dynamic = "force-dynamic";

async function doUnsubscribe(id: string, token: string) {
  "use server";
  if (!verifyUnsubscribeToken(id, token)) redirect(`/u/${id}/${token}?status=ungueltig`);
  await unsubscribeContact(id, "Abmeldeseite");
  redirect(`/u/${id}/${token}?status=fertig`);
}

// Bestätigung per Button (POST), damit Link-Scanner in Mailprogrammen niemanden abmelden.
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; token: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id, token } = await params;
  const { status } = await searchParams;
  const valid = verifyUnsubscribeToken(id, token);

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow-sm dark:bg-ink-900">
      <h1 className="mb-3 text-lg font-semibold">E-Mail-Abmeldung</h1>
      {!valid || status === "ungueltig" ? (
        <p className="text-sm">Dieser Abmeldelink ist ungültig.</p>
      ) : status === "fertig" ? (
        <p role="status" className="text-sm">Sie sind abgemeldet und erhalten keine weiteren E-Mails mehr.</p>
      ) : (
        <form action={doUnsubscribe.bind(null, id, token)} className="space-y-3">
          <p className="text-sm">Möchten Sie sich von allen weiteren E-Mails abmelden?</p>
          <button className={btnCls}>Ja, abmelden</button>
        </form>
      )}
    </div>
  );
}
