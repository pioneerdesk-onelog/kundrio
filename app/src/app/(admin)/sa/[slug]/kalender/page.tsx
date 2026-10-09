import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { contactName } from "@/lib/a-format";
import { btnCls, btnGhostCls, Card, Empty, inputCls, PageHeader } from "@/components/ui";
import { cancelMeetingAction, createEvent, deleteEvent } from "./actions";
import { ScheduleMeetingButton } from "@/components/calendar/ScheduleMeetingButton";
import { VIDEO_LABEL, type VideoProvider } from "@/lib/calendar/config";
import { hasSpecial } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function parseMonth(m?: string) {
  const match = m?.match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const y = match ? Number(match[1]) : now.getFullYear();
  const mo = match ? Number(match[2]) - 1 : now.getMonth();
  return new Date(y, Math.min(Math.max(mo, 0), 11), 1);
}
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const dayKey = (d: Date) => `${key(d)}-${String(d.getDate()).padStart(2, "0")}`;
const time = (d: Date) => new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(d);

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ m?: string; wer?: string }>;
}) {
  const { slug } = await params;
  const { m, wer } = await searchParams;
  const { ws, access, user } = await pageAccess(slug);
  const mine = wer === "meine";
  const booked = wer === "gebucht";
  const werQ = mine ? "meine" : booked ? "gebucht" : null;
  const month = parseMonth(m);
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const prev = new Date(month.getFullYear(), month.getMonth() - 1, 1);

  // Raster: Montag vor dem Monatsersten bis Sonntag nach dem Monatsende
  const gridStart = new Date(month);
  gridStart.setDate(1 - ((month.getDay() + 6) % 7));
  const days: Date[] = [];
  for (let d = new Date(gridStart); d < next || days.length % 7 !== 0; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const gridEnd = new Date(days[days.length - 1]);
  gridEnd.setDate(gridEnd.getDate() + 1);

  const [events, contacts] = await Promise.all([
    db.event.findMany({
      // Termine ohne Kontakt oder mit Kontakt in der eigenen Reichweite
      where: {
        workspaceId: ws.id,
        startsAt: { lt: gridEnd },
        endsAt: { gte: gridStart },
        OR: [{ contactId: null }, { contact: withScope({}, access, "contacts") }],
        ...(mine ? { ownerId: user.id } : {}),
        // Reservierungen während einer laufenden Online-Buchung nicht anzeigen
        status: { not: "held" },
        ...(booked ? { source: "booking" } : {}),
      },
      include: { contact: true, owner: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
    }),
    db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), orderBy: { createdAt: "desc" }, take: 500, select: { id: true, firstName: true, lastName: true, email: true } }),
  ]);
  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const k = dayKey(e.startsAt);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const today = dayKey(new Date());
  const monthLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(month);
  const inMonth = events.filter((e) => e.startsAt >= month && e.startsAt < next);

  return (
    <div className="space-y-6">
      <PageHeader title={`Kalender · ${monthLabel}`}>
        <Link href={`/sa/${slug}/kalender?m=${key(prev)}${werQ ? `&wer=${werQ}` : ""}`} className={btnGhostCls} aria-label="Vormonat">←</Link>
        <Link href={`/sa/${slug}/kalender${werQ ? `?wer=${werQ}` : ""}`} className={btnGhostCls}>Heute</Link>
        <Link href={`/sa/${slug}/kalender?m=${key(next)}${werQ ? `&wer=${werQ}` : ""}`} className={btnGhostCls} aria-label="Folgemonat">→</Link>
        <ScheduleMeetingButton slug={slug} workspaceId={ws.id} />
      </PageHeader>
      <nav className="flex flex-wrap items-center gap-3 text-sm" aria-label="Kalender-Ansicht">
        <Link href={`/sa/${slug}/kalender?m=${key(month)}`} aria-current={!werQ ? "page" : undefined} className={!werQ ? "font-semibold text-accent-500 dark:text-accent-100" : "hover:underline"}>Team</Link>
        <Link href={`/sa/${slug}/kalender?m=${key(month)}&wer=meine`} aria-current={mine ? "page" : undefined} className={mine ? "font-semibold text-accent-500 dark:text-accent-100" : "hover:underline"}>Meine Termine</Link>
        <Link href={`/sa/${slug}/kalender?m=${key(month)}&wer=gebucht`} aria-current={booked ? "page" : undefined} className={booked ? "font-semibold text-accent-500 dark:text-accent-100" : "hover:underline"}>Online gebucht</Link>
        <span className="text-ink-200">|</span>
        <Link href={`/sa/${slug}/kalender/vorlagen`} className="hover:underline">Terminvorlagen</Link>
        {hasSpecial(access, "manage_settings") && <Link href={`/sa/${slug}/kalender/einstellungen`} className="hover:underline">Teamkalender</Link>}
        <Link href="/konto/kalender" className="hover:underline">Meine Kalender-Verbindungen</Link>
      </nav>

      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-black/10 bg-white text-sm dark:border-white/10 dark:bg-ink-900">
        {WEEKDAYS.map((w) => <div key={w} className="border-b border-black/10 p-2 text-xs font-semibold text-ink-400 dark:text-ink-200 dark:border-white/10">{w}</div>)}
        {days.map((d) => {
          const k = dayKey(d);
          const out = d.getMonth() !== month.getMonth();
          return (
            <div key={k} className={`min-h-24 border-b border-r border-black/5 p-1.5 dark:border-white/5 ${out ? "bg-black/[0.02] text-ink-400 dark:bg-white/[0.02]" : ""}`}>
              <div className={`mb-1 text-xs ${k === today ? "inline-block rounded-full bg-accent-500 px-1.5 text-white" : ""}`}>{d.getDate()}</div>
              {(byDay.get(k) ?? []).map((e) => (
                <div key={e.id} className={`mb-0.5 truncate rounded px-1 text-xs ${e.status === "cancelled" ? "line-through text-ink-600 dark:text-ink-200" : ""}`} style={{ background: `${ws.brandPrimary}22` }} title={e.title}>
                  {e.joinUrl && <span aria-label="Video-Call">🎥 </span>}
                  {time(e.startsAt)} {e.title}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Termine in diesem Monat">
          {inMonth.length === 0 ? <Empty>Keine Termine.</Empty> : (
            <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
              {inMonth.map((e) => (
                <li key={e.id} className={`flex flex-wrap items-center gap-2 py-1.5 ${e.status === "cancelled" ? "text-ink-600 dark:text-ink-200" : ""}`}>
                  <span className="w-40 text-xs text-ink-400 dark:text-ink-200">{formatDate(e.startsAt, true)}</span>
                  <span className="flex-1">
                    <span className={e.status === "cancelled" ? "line-through" : ""}>{e.title}</span>
                    {e.status === "cancelled" && <span className="ml-1 text-xs text-red-700 dark:text-red-300">abgesagt</span>}
                    {e.videoProvider !== "none" && <span className="text-ink-400 dark:text-ink-200"> · {VIDEO_LABEL[e.videoProvider as VideoProvider] ?? e.videoProvider}</span>}
                    {e.location && <span className="text-ink-400 dark:text-ink-200"> · {e.location}</span>}
                    {e.contact && (
                      <> · <Link href={`/sa/${slug}/kontakte/${e.contact.id}`} className="text-ink-600 underline dark:text-ink-200">{contactName(e.contact)}</Link></>
                    )}
                    {e.owner && <span className="text-ink-400 dark:text-ink-200"> · {e.owner.name}</span>}
                    {Array.isArray(e.attendees) && e.attendees.length > 0 && (
                      <span className="block text-xs text-ink-400 dark:text-ink-200">
                        {(e.attendees as { email: string; name?: string | null; response?: string }[]).map((a) => `${a.name || a.email}: ${a.response ?? "offen"}`).join(" · ")}
                      </span>
                    )}
                  </span>
                  {e.joinUrl && e.status !== "cancelled" && (
                    <a href={e.joinUrl} target="_blank" rel="noreferrer" className="rounded-md bg-accent-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-accent-600">Beitreten</a>
                  )}
                  {e.status !== "cancelled" && e.videoProvider !== "none" && (e.ownerId === user.id || can(access, "tasks", "delete")) && (
                    <form action={cancelMeetingAction.bind(null, slug, e.id)}>
                      <button className="text-xs text-ink-400 hover:text-red-600" aria-label={`Termin „${e.title}“ absagen`}>Absagen</button>
                    </form>
                  )}
                  {e.videoProvider === "none" && can(access, "tasks", "delete") && (
                    <form action={deleteEvent.bind(null, slug, e.id)}>
                      <button className="text-xs text-ink-400 hover:text-red-600" title="Löschen" aria-label={`Termin „${e.title}“ löschen`}>✕</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {can(access, "tasks", "edit") && (
        <Card title="Termin anlegen">
          <form action={createEvent.bind(null, slug)} className="grid grid-cols-2 gap-2">
            <input name="title" required placeholder="Titel" className={`${inputCls} col-span-2`} />
            <label className="text-xs text-ink-400 dark:text-ink-200">Beginn<input name="startsAt" type="datetime-local" required className={inputCls} /></label>
            <label className="text-xs text-ink-400 dark:text-ink-200">Ende (optional)<input name="endsAt" type="datetime-local" className={inputCls} /></label>
            <input name="location" placeholder="Ort / Link" className={inputCls} />
            <select name="contactId" defaultValue="" className={inputCls} aria-label="Kontakt">
              <option value="">Ohne Kontakt</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
            </select>
            <div className="col-span-2"><button className={btnCls}>Anlegen</button></div>
          </form>
        </Card>
        )}
      </div>
    </div>
  );
}
