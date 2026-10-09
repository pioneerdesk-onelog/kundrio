import Link from "next/link";
import { db } from "@/lib/db";
import { hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { ensureDefaultMeetingTypes } from "@/lib/calendar/defaults";
import { VIDEO_LABEL, type VideoProvider } from "@/lib/calendar/config";
import { Badge, btnDangerCls, Card, PageHeader } from "@/components/ui";
import { MeetingTypeForm } from "@/components/calendar/MeetingTypeForm";
import { deleteMeetingType, saveBookingSettings, saveMeetingType } from "./actions";
import { BookingSettingsForm } from "./BookingSettingsForm";
import { parseAvailability, parseQuestions, rangesToText, WEEKDAYS, WEEKDAY_LABEL } from "@/lib/calendar/booking/rules";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function MeetingTypesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ id?: string }> }) {
  const { slug } = await params;
  const { id } = await searchParams;
  const { ws, access } = await pageAccess(slug);
  await ensureDefaultMeetingTypes(ws.id);
  const canEdit = hasSpecial(access, "manage_settings");
  const types = await db.meetingType.findMany({ where: { workspaceId: ws.id }, orderBy: { name: "asc" }, include: { _count: { select: { events: true } } } });
  const current = id ? types.find((t) => t.id === id) : undefined;
  const avail = parseAvailability(current?.availability);
  // Mögliche Gastgeber: Personen mit Zugriff + Kalenderstatus
  const memberUsers = await db.user.findMany({
    where: { active: true, OR: [{ memberships: { some: { workspaceId: ws.id } } }, { agencyRole: { in: ["owner", "admin"] } }] },
    select: { id: true, name: true, calendarConnections: { where: { status: "active" }, select: { provider: true } } },
    orderBy: { name: "asc" },
  });
  const hosts = memberUsers.map((u) => ({ id: u.id, name: u.name, calendar: u.calendarConnections[0] ? (u.calendarConnections[0].provider === "google" ? "Google" : "Microsoft") : null }));

  return (
    <div className="space-y-6">
      <PageHeader title="Terminvorlagen" description="Einheitliche Einladungen für diesen Sub-Account: Titel, Text, Dauer, Video-Anbieter und Erinnerungen. Platzhalter werden beim Einladen ersetzt.">
        <Link href={`/sa/${slug}/kalender`} className="text-sm text-accent-500 dark:text-accent-100 hover:underline">← Kalender</Link>
      </PageHeader>

      <Card title="Vorlagen">
        <ul className="divide-y divide-ink-100 dark:divide-white/10">
          {types.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <Link href={`/sa/${slug}/kalender/vorlagen?id=${t.id}`} className="flex-1 font-medium hover:underline">
                {t.name}
              </Link>
              <span className="text-sm text-ink-400 dark:text-ink-200">{t.durationMin} min</span>
              <Badge tone="accent">{VIDEO_LABEL[t.videoProvider as VideoProvider] ?? t.videoProvider}</Badge>
              {t.bookingEnabled && t.bookingSlug && <Badge tone="ok">online buchbar</Badge>}
              {!t.active && <Badge tone="warn">inaktiv</Badge>}
              <span className="text-xs text-ink-400">{t._count.events} Termine</span>
              {canEdit && (
                <form action={deleteMeetingType.bind(null, slug, t.id)}>
                  <button className={btnDangerCls} aria-label={`Vorlage ${t.name} löschen`}>
                    Löschen
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={current ? `Vorlage bearbeiten: ${current.name}` : "Neue Vorlage"}>
        {!canEdit && <p className="mb-3 text-sm text-ink-400">Nur mit dem Recht „Einstellungen“ bearbeitbar.</p>}
        <MeetingTypeForm
          key={current?.id ?? "neu"}
          action={saveMeetingType.bind(null, slug, current?.id ?? null)}
          canEdit={canEdit}
          values={
            current
              ? {
                  name: current.name,
                  titleTemplate: current.titleTemplate,
                  description: current.description ?? "",
                  durationMin: current.durationMin,
                  bufferMin: current.bufferMin,
                  videoProvider: current.videoProvider,
                  location: current.location ?? "",
                  reminders: current.reminders.join(", "),
                  addToTeamCalendar: current.addToTeamCalendar,
                  active: current.active,
                }
              : undefined
          }
        />
      </Card>

      {current && (
        <Card title={`Online-Buchung: ${current.name}`}>
          <p className="mb-4 text-sm text-ink-400 dark:text-ink-200">
            Kundinnen und Kunden buchen freie Zeiten selbst. Freie Zeiten = Wochenzeiten minus belegte Zeiten der Gastgeber (Google/Microsoft-Kalender bzw. CRM-Termine), mit Puffer und Vorlauf. Die Einladung mit Video-Link geht automatisch raus.
          </p>
          <BookingSettingsForm
            key={`b-${current.id}`}
            action={saveBookingSettings.bind(null, slug, current.id)}
            canEdit={canEdit}
            hosts={hosts.map((h) => ({ id: h.id, name: h.name, calendar: h.calendar }))}
            bookingUrl={current.bookingSlug ? `${env.appUrl()}/buchen/${ws.slug}/${current.bookingSlug}` : null}
            blockPath={current.bookingSlug ? `/buchen/${ws.slug}/${current.bookingSlug}` : null}
            values={{
              bookingEnabled: current.bookingEnabled,
              bookingSlug: current.bookingSlug ?? "",
              days: WEEKDAYS.map((d) => ({ key: d, label: WEEKDAY_LABEL[d], on: avail.hours[d].length > 0, text: rangesToText(avail.hours[d]) || "09:00-17:00" })),
              zeitzone: avail.zeitzone,
              feiertage: avail.feiertage,
              minNoticeHours: current.minNoticeHours,
              maxDaysAhead: current.maxDaysAhead,
              slotIntervalMin: current.slotIntervalMin,
              bufferMin: current.bufferMin,
              confirmationText: current.confirmationText ?? "",
              hostUserIds: current.hostUserIds,
              questions: parseQuestions(current.questions).map((q) => ({ label: q.label, type: q.type, required: q.required })),
            }}
          />
        </Card>
      )}
    </div>
  );
}
