import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isAgencyStaff } from "@/lib/permissions";
import { formatDate } from "@/lib/workspace";
import { isConfigured, PROVIDER_LABEL, PROVIDERS, redirectUri, SCOPES } from "@/lib/calendar/config";
import { disconnect } from "@/lib/calendar/connections";
import { Badge, btnCls, btnDangerCls, Card, Empty, PageHeader } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";

export const dynamic = "force-dynamic";

async function disconnectAction(connectionId: string) {
  "use server";
  const user = await requireUser();
  await disconnect(user.id, connectionId);
  redirect(`/konto/kalender?ok=${encodeURIComponent("Kalender getrennt.")}`);
}

export default async function KalenderVerbindungenPage({ searchParams }: { searchParams: FlashParams }) {
  const user = await requireUser();
  const flash = await searchParams;
  const conns = await db.calendarConnection.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Meine Kalender"
        description="Verbinden Sie Ihren Google- oder Microsoft-Kalender. Termine aus dem CRM landen dann in Ihrem Kalender, Kunden erhalten die Einladung mit Meet- bzw. Teams-Link direkt von Google/Microsoft."
      >
        <Link href="/konto" className="text-sm text-accent-500 dark:text-accent-100 hover:underline">← Konto</Link>
      </PageHeader>
      <Flash {...flash} />

      <Card title="Verbundene Kalender">
        {conns.length === 0 ? (
          <Empty>Noch kein Kalender verbunden. Ohne Verbindung verschickt das CRM Einladungen als .ics-Anhang mit Jitsi-Link.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {conns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex-1">
                  <div className="font-medium">{PROVIDER_LABEL[c.provider as "google" | "microsoft"] ?? c.provider}</div>
                  <div className="text-sm text-ink-400 dark:text-ink-200">
                    {c.accountEmail} · verbunden seit {formatDate(c.createdAt)}
                  </div>
                  {c.lastError && <div className="text-sm text-red-700 dark:text-red-300">{c.lastError}</div>}
                </div>
                {c.status === "active" ? <Badge tone="ok">aktiv</Badge> : <Badge tone="warn">neu verbinden</Badge>}
                {c.status !== "active" && (
                  <a href={`/api/calendar/oauth/${c.provider}/start`} className={btnCls}>
                    Neu verbinden
                  </a>
                )}
                <form action={disconnectAction.bind(null, c.id)}>
                  <button className={btnDangerCls}>Trennen</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => (
          <Card key={p} title={PROVIDER_LABEL[p]}>
            {isConfigured(p) ? (
              <>
                <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">
                  {p === "google"
                    ? "Termine mit Google Meet, Frei/Belegt für Terminvorschläge."
                    : "Termine mit Microsoft Teams (Geschäftskonto nötig), Frei/Belegt für Terminvorschläge."}
                </p>
                <a href={`/api/calendar/oauth/${p}/start`} className={btnCls}>
                  {conns.some((c) => c.provider === p) ? "Weiteres Konto verbinden" : "Verbinden"}
                </a>
                <p className="mt-3 text-xs text-ink-400 dark:text-ink-200">Angefragte Rechte: {SCOPES[p].join(", ")}</p>
              </>
            ) : !isAgencyStaff(user) ? (
              // Fachrollen: kein Technik-Text (Umgebungsvariablen, App-Registrierung), nur wer weiterhilft
              <p className="text-sm text-ink-600 dark:text-ink-200">
                <strong>Noch nicht eingerichtet.</strong> Die Verbindung mit {PROVIDER_LABEL[p]} muss einmalig von der Agentur-Administration freigeschaltet werden. Bis dahin verschickt das CRM Einladungen als .ics-Anhang.
              </p>
            ) : (
              <div className="space-y-2 text-sm text-ink-600 dark:text-ink-200">
                <p>
                  <strong>Noch nicht eingerichtet.</strong> Eine Administratorin muss einmalig eine App registrieren und die Zugangsdaten als
                  Umgebungsvariablen hinterlegen ({p === "google" ? "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET" : "MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT"}).
                </p>
                <p>
                  Weiterleitungs-URL: <code className="break-all">{redirectUri(p)}</code>
                </p>
                <p>{p === "google" ? "Google Cloud Console → APIs & Dienste → Google Calendar API aktivieren → OAuth-Client (Webanwendung)." : "Microsoft Entra ID → App-Registrierungen → neue App (Web) → delegierte Berechtigungen Calendars.ReadWrite, User.Read, offline_access."}</p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
