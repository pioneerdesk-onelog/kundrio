import Link from "next/link";
import { db } from "@/lib/db";
import { hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { PROVIDER_LABEL, type Provider } from "@/lib/calendar/config";
import { listCalendarsFor } from "@/lib/calendar/service";
import { btnCls, btnDangerCls, Card, Empty, inputCls, PageHeader } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";
import { clearTeamCalendar, setTeamCalendar } from "./actions";

export const dynamic = "force-dynamic";

type Team = { provider: Provider; calendarId: string; connectionId: string; name?: string; account?: string };

export default async function TeamCalendarSettings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: FlashParams }) {
  const { slug } = await params;
  const flash = await searchParams;
  const { ws, access, user } = await pageAccess(slug);
  const canEdit = hasSpecial(access, "manage_settings");
  const team = ws.teamCalendar as Team | null;
  const teamConn = team ? await db.calendarConnection.findUnique({ where: { id: team.connectionId }, select: { status: true, accountEmail: true } }) : null;
  const myConns = await db.calendarConnection.findMany({ where: { userId: user.id, status: "active" } });
  const options: { value: string; label: string }[] = [];
  const errors: string[] = [];
  if (canEdit) {
    for (const c of myConns) {
      try {
        for (const cal of await listCalendarsFor(c.id, user.id)) {
          options.push({ value: `${c.id}|${cal.id}`, label: `${PROVIDER_LABEL[c.provider as Provider]} · ${c.accountEmail} · ${cal.name}${cal.primary ? " (Hauptkalender)" : ""}` });
        }
      } catch (e) {
        errors.push(`${c.accountEmail}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Teamkalender" description="Termine aus diesem Sub-Account werden zusätzlich in einen gemeinsamen Kalender eingetragen – ohne erneute Einladung an Kunden, mit Video-Link und Teilnehmenden.">
        <Link href={`/sa/${slug}/kalender`} className="text-sm text-accent-500 dark:text-accent-100 hover:underline">← Kalender</Link>
      </PageHeader>
      <Flash {...flash} />
      <Card title="Aktueller Teamkalender">
        {team ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 text-sm">
              <div className="font-medium">{team.name ?? team.calendarId}</div>
              <div className="text-ink-400 dark:text-ink-200">
                {PROVIDER_LABEL[team.provider]} · {team.account ?? teamConn?.accountEmail ?? "?"} {teamConn?.status !== "active" && "· Verbindung nicht aktiv"}
              </div>
            </div>
            {canEdit && (
              <form action={clearTeamCalendar.bind(null, slug)}>
                <button className={btnDangerCls}>Entfernen</button>
              </form>
            )}
          </div>
        ) : (
          <Empty>Kein Teamkalender festgelegt.</Empty>
        )}
      </Card>
      {canEdit && (
        <Card title="Teamkalender festlegen">
          {myConns.length === 0 ? (
            <p className="text-sm text-ink-600 dark:text-ink-200">
              Verbinden Sie zuerst Ihren Kalender unter <Link href="/konto/kalender" className="text-accent-500 dark:text-accent-100 hover:underline">Konto → Kalender</Link>. Empfehlung: Google – ein freigegebener Kalender
              des Teams; Microsoft – ein Kalender, den alle im Team sehen (z. B. freigegebener Kalender eines Team-Postfachs).
            </p>
          ) : (
            <form action={setTeamCalendar.bind(null, slug)} className="space-y-3">
              <select name="calendar" required className={inputCls} defaultValue={team ? `${team.connectionId}|${team.calendarId}` : ""}>
                <option value="">– Kalender wählen –</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {errors.map((e) => (
                <p key={e} className="text-sm text-red-700 dark:text-red-300">{e}</p>
              ))}
              <button className={btnCls}>Speichern</button>
              <p className="text-xs text-ink-400">Die Einträge laufen über Ihre Verbindung. Trennen Sie diese, muss der Teamkalender neu festgelegt werden.</p>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
