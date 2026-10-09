import "server-only";
import type { MeetingType, Prisma, Workspace } from "@prisma/client";
import { db } from "../../db";
import { env } from "../../env";
import { audit } from "../../audit";
import { emitEvent } from "../../events";
import { sendMail, SuppressedError } from "../../mail";
import { rateLimitAsync } from "../../ratelimit";
import { doiToken } from "../../b-doi";
import { verifyFormTimestamp } from "../../trust";
import { recentSubmissions, scoreContact } from "../../agent-leads";
import { isValidOwner } from "../../objects/defaults";
import { log, errMessage } from "../../log";
import { busyFor } from "../service";
import { activeConnection } from "../connections";
import { requiredConnection, VIDEO_LABEL, type VideoProvider } from "../config";
import { cancelMeeting, MeetingError, rescheduleMeeting, scheduleMeeting } from "../meetings";
import { formatRange, utcToZonedLocal } from "../time";
import { buildIcs } from "../ics";
import { computeSlots, neutralizePlaceholders, parseAvailability, parseQuestions, type Busy, type Slot } from "./rules";
import { bookingDoiKey, bookingFormKey, hashManageToken, isWellFormedToken, newManageToken } from "./token";

// Öffentlicher Buchungskalender: freie Zeiten, Buchung mit Doppelbuchungsschutz, Umbuchen/Absagen
// über einen Verwaltungslink, Erinnerungen. Termin-Anlage über den bestehenden Kalender-Service
// (Meet/Teams/Jitsi gemäß Vorlage, Einladung an den Gast).

export class BookingError extends Error {}

const HOLD_TTL_MS = 10 * 60_000;
const MAX_DAYS = 90;

export const manageUrl = (token: string) => `${env.appUrl()}/buchen/termin/${token}`;
export const bookingPageUrl = (wsSlug: string, bookingSlug: string) => `${env.appUrl()}/buchen/${wsSlug}/${bookingSlug}`;

/** Öffentlich buchbare Vorlage zur Adresse – sonst null (404). */
export async function loadBookingPage(wsSlug: string, bookingSlug: string) {
  const ws = await db.workspace.findUnique({ where: { slug: wsSlug } });
  if (!ws) return null;
  const mt = await db.meetingType.findFirst({ where: { workspaceId: ws.id, bookingSlug, bookingEnabled: true, active: true } });
  return mt ? { ws, mt } : null;
}

/** Gastgeber (Rundlauf): konfigurierte Personen mit Zugriff; leer → Admins des Sub-Accounts, sonst Agentur-Inhaber. */
export async function bookingHosts(ws: Workspace, mt: MeetingType) {
  const ids: string[] = [];
  for (const id of mt.hostUserIds) if (await isValidOwner(ws.id, id)) ids.push(id);
  if (ids.length === 0) {
    const admins = await db.membership.findMany({
      where: { workspaceId: ws.id, roleRef: { key: "admin" }, user: { active: true } },
      select: { userId: true },
      orderBy: { userId: "asc" },
    });
    ids.push(...admins.map((a) => a.userId));
  }
  if (ids.length === 0) {
    const owner = await db.user.findFirst({ where: { active: true, agencyRole: "owner" }, select: { id: true }, orderBy: { createdAt: "asc" } });
    if (owner) ids.push(owner.id);
  }
  return db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
}

/** Belegt je Gastgeber: Kalender (Google/Microsoft) bzw. CRM-Termine + laufende Reservierungen. */
async function busyMap(hostIds: string[], from: Date, to: Date, ignoreEventId?: string) {
  const out: Record<string, Busy[]> = {};
  const holdsSince = new Date(Date.now() - HOLD_TTL_MS);
  for (const id of hostIds) {
    let busy: Busy[] = [];
    try {
      busy = (await busyFor(id, from, to)).busy;
    } catch (e) {
      // Kalender nicht erreichbar → nur CRM-Termine (nie die Buchungsseite blockieren)
      log.warn("booking busy lookup failed", { error: errMessage(e) });
      const crm = await db.event.findMany({ where: { ownerId: id, status: "scheduled", startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } });
      busy = crm.map((e) => ({ start: e.startsAt, end: e.endsAt }));
    }
    if (ignoreEventId) {
      const ev = await db.event.findUnique({ where: { id: ignoreEventId }, select: { startsAt: true, endsAt: true } });
      if (ev) busy = busy.filter((b) => !(b.start.getTime() === ev.startsAt.getTime() && b.end.getTime() === ev.endsAt.getTime()));
    }
    const holds = await db.event.findMany({
      where: { ownerId: id, status: "held", createdAt: { gt: holdsSince }, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true },
    });
    out[id] = [...busy, ...holds.map((h) => ({ start: h.startsAt, end: h.endsAt }))];
  }
  return out;
}

/** Freie Zeiten einer Vorlage (optional nur bestimmte Gastgeber/Tage). */
export async function availableSlots(ws: Workspace, mt: MeetingType, o: { fromDay?: string; toDay?: string; onlyHostIds?: string[]; ignoreEventId?: string; now?: Date } = {}): Promise<Slot[]> {
  const now = o.now ?? new Date();
  const hosts = (await bookingHosts(ws, mt)).map((h) => h.id).filter((id) => !o.onlyHostIds || o.onlyHostIds.includes(id));
  if (hosts.length === 0) return [];
  const maxDays = Math.min(Math.max(mt.maxDaysAhead, 1), MAX_DAYS);
  const from = new Date(now.getTime());
  const to = new Date(now.getTime() + (maxDays + 1) * 864e5);
  const busy = await busyMap(hosts, from, to, o.ignoreEventId);
  return computeSlots({
    now,
    availability: parseAvailability(mt.availability),
    durationMin: mt.durationMin,
    bufferMin: mt.bufferMin,
    slotIntervalMin: mt.slotIntervalMin,
    minNoticeHours: mt.minNoticeHours,
    maxDaysAhead: maxDays,
    hostIds: hosts,
    busyByHost: busy,
    fromDay: o.fromDay,
    toDay: o.toDay,
  });
}

/** Reservierung unter Sperre je Gastgeber: Überschneidung erneut prüfen, dann Platzhalter-Termin. */
async function holdSlot(ws: Workspace, mt: MeetingType, hostId: string, start: Date, end: Date, ignoreEventId?: string) {
  const buf = mt.bufferMin * 60000;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${hostId}`}, 0))) AS l`;
    const clash = await tx.event.findFirst({
      where: {
        ownerId: hostId,
        id: ignoreEventId ? { not: ignoreEventId } : undefined,
        OR: [{ status: "scheduled" }, { status: "held", createdAt: { gt: new Date(Date.now() - HOLD_TTL_MS) } }],
        startsAt: { lt: new Date(end.getTime() + buf) },
        endsAt: { gt: new Date(start.getTime() - buf) },
      },
      select: { id: true },
    });
    if (clash) return null;
    return tx.event.create({
      data: { workspaceId: ws.id, title: "Reservierung (Online-Buchung läuft)", startsAt: start, endsAt: end, ownerId: hostId, status: "held", source: "booking", meetingTypeId: mt.id },
      select: { id: true },
    });
  });
}

/** Rundlauf: Gastgeber mit den wenigsten Online-Buchungen der letzten 30 Tage zuerst. */
async function orderHosts(hostIds: string[]) {
  const since = new Date(Date.now() - 30 * 864e5);
  const counts = await db.event.groupBy({ by: ["ownerId"], where: { ownerId: { in: hostIds }, source: "booking", status: "scheduled", createdAt: { gt: since } }, _count: true });
  const n = (id: string) => counts.find((c) => c.ownerId === id)?._count ?? 0;
  return [...hostIds].sort((a, b) => n(a) - n(b));
}

/** Video-Anbieter der Vorlage; fehlt dem Gastgeber die nötige Kalenderverbindung → Jitsi (Hinweis). */
async function videoFor(mt: MeetingType, hostId: string): Promise<{ video: VideoProvider; note?: string }> {
  const v = mt.videoProvider as VideoProvider;
  const need = requiredConnection(v);
  if (!need) return { video: v };
  if (await activeConnection(hostId, need)) return { video: v };
  return { video: "jitsi", note: `${VIDEO_LABEL[v]} nicht verfügbar (Kalender des Gastgebers nicht verbunden) – Jitsi verwendet.` };
}

export type GuestInput = { firstName: string; lastName: string; email: string; phone?: string | null; company?: string | null };

export type BookInput = {
  ws: Workspace;
  mt: MeetingType;
  start: Date;
  guest: GuestInput;
  answers: Record<string, string>;
  newsletterConsent: boolean;
  formTs?: string | null;
  userAgent?: string | null;
};

/** Bucht einen freien Termin. Wirft BookingError mit verständlicher Meldung. */
export async function bookSlot(i: BookInput) {
  const { ws, mt } = i;
  const email = i.guest.email.trim().toLowerCase();
  const day = utcToZonedLocal(i.start, parseAvailability(mt.availability).zeitzone).slice(0, 10);
  const slots = await availableSlots(ws, mt, { fromDay: day, toDay: day });
  const slot = slots.find((s) => s.start.getTime() === i.start.getTime());
  if (!slot) throw new BookingError("Dieser Termin ist leider nicht mehr frei. Bitte wählen Sie eine andere Zeit.");

  // Gastgeber im Rundlauf; unter Sperre reservieren (Doppelbuchungsschutz)
  let hold: { id: string } | null = null;
  let hostId = "";
  for (const h of await orderHosts(slot.hostIds)) {
    hold = await holdSlot(ws, mt, h, slot.start, slot.end);
    if (hold) {
      hostId = h;
      break;
    }
  }
  if (!hold) throw new BookingError("Dieser Termin wurde gerade vergeben. Bitte wählen Sie eine andere Zeit.");

  try {
    // Kontakt zuordnen bzw. anlegen (öffentliche Angaben überschreiben nichts, sie ergänzen nur)
    const existing = await db.contact.findUnique({ where: { workspaceId_email: { workspaceId: ws.id, email } } });
    const fill = { firstName: i.guest.firstName, lastName: i.guest.lastName, phone: i.guest.phone || null, company: i.guest.company || null };
    let contactId: string;
    if (existing) {
      const patch = Object.fromEntries(Object.entries(fill).filter(([k, v]) => v && !existing[k as keyof typeof fill]));
      if (Object.keys(patch).length) await db.contact.update({ where: { id: existing.id }, data: patch });
      contactId = existing.id;
    } else {
      const c = await db.$transaction(async (tx) => {
        const c = await tx.contact.create({ data: { workspaceId: ws.id, email, source: `Online-Buchung: ${mt.name}`.slice(0, 200), ...fill } });
        await emitEvent({ workspaceId: ws.id, type: "contact.created", objectType: "contact", objectId: c.id, data: { source: "booking" } }, tx);
        return c;
      });
      contactId = c.id;
    }

    // Lead-Echtheit (darf die Buchung nie verhindern)
    await scoreContact(contactId, {
      email,
      elapsedMs: verifyFormTimestamp(env.appSecret(), bookingFormKey(mt.id), i.formTs ?? null),
      userAgent: i.userAgent ?? null,
      recentCount: Math.max(0, (await recentSubmissions(contactId)) - 1),
    });

    const { token, hash } = newManageToken(env.appSecret());
    const questions = parseQuestions(mt.questions);
    const answerLines = questions
      .map((q) => (i.answers[q.key] ? `${q.label}: ${neutralizePlaceholders(i.answers[q.key])}` : null))
      .filter(Boolean) as string[];
    const description = [
      mt.description ?? "",
      answerLines.length ? `Angaben aus der Buchung:\n${answerLines.join("\n")}` : "",
      `Termin verwalten (umbuchen/absagen): ${manageUrl(token)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const { video, note } = await videoFor(mt, hostId);
    const res = await scheduleMeeting(
      { workspaceId: ws.id, organizerId: hostId, meetingTypeId: mt.id, start: slot.start, durationMin: mt.durationMin, videoProvider: video, location: mt.location, description, contactIds: [contactId] },
      "booking:public",
    );

    await db.$transaction(async (tx) => {
      await tx.event.deleteMany({ where: { id: hold!.id, status: "held" } });
      await tx.event.update({ where: { id: res.eventId }, data: { source: "booking", bookingTokenHash: hash } });
      await tx.activity.create({
        data: {
          workspaceId: ws.id,
          contactId,
          type: "SYSTEM",
          body: `Online gebucht: ${mt.name} (${formatRange(slot.start, slot.end)})`,
          meta: { eventId: res.eventId, meetingTypeId: mt.id, answers: Object.fromEntries(answerLines.map((l, k) => [k, l])) },
        },
      });
      await emitEvent(
        { workspaceId: ws.id, type: "meeting.booked", objectType: "contact", objectId: contactId, data: { eventId: res.eventId, meetingTypeId: mt.id, startsAt: slot.start.toISOString(), hostId } },
        tx,
      );
    });
    await audit({ workspaceId: ws.id, actor: "booking:public", action: "meeting.booked", target: res.eventId, detail: { meetingTypeId: mt.id, warnings: res.warnings.length } });
    if (note) log.info("booking video fallback", { workspaceId: ws.id, meetingTypeId: mt.id });

    // Bestätigung mit Verwaltungslink (Einladung kommt zusätzlich von Google/Microsoft bzw. als .ics)
    await sendBookingMail(ws.id, contactId, email, "confirm", { title: mt.name, start: slot.start, end: slot.end, joinUrl: res.joinUrl, location: mt.location, token, text: mt.confirmationText });

    if (i.newsletterConsent) await requestNewsletterDoi(ws, mt, contactId, email);
    return { token, eventId: res.eventId, joinUrl: res.joinUrl, warnings: note ? [note, ...res.warnings] : res.warnings };
  } catch (e) {
    await db.event.deleteMany({ where: { id: hold.id, status: "held" } }).catch(() => {});
    if (e instanceof MeetingError) throw new BookingError(e.message);
    throw e;
  }
}

async function requestNewsletterDoi(ws: Workspace, mt: MeetingType, contactId: string, email: string) {
  const c = await db.contact.findUnique({ where: { id: contactId }, select: { consentEmailAt: true, unsubscribedAt: true } });
  if (c?.consentEmailAt && !c.unsubscribedAt) return;
  if (!(await rateLimitAsync(`doi:${ws.id}:${email}`, 1, 60 * 60_000))) return;
  const url = `${env.appUrl()}/buchen/einwilligung/${contactId}/${doiToken(contactId, bookingDoiKey(mt.id))}`;
  try {
    await sendMail({
      workspaceId: ws.id,
      to: email,
      contactId,
      kind: "system",
      subject: "Bitte bestätigen Sie Ihre Anmeldung",
      text: `Hallo,\n\nSie haben bei Ihrer Terminbuchung angegeben, Neuigkeiten von ${ws.name} per E-Mail erhalten zu wollen.\n\nBitte bestätigen Sie das über diesen Link (7 Tage gültig):\n${url}\n\nWenn Sie das nicht waren, ignorieren Sie diese E-Mail einfach. Ohne Bestätigung erhalten Sie keine weiteren E-Mails.`,
    });
  } catch (e) {
    log.warn("booking doi mail failed", { error: errMessage(e) });
  }
}

type MailKind = "confirm" | "rescheduled" | "cancelled" | "reminder";

async function sendBookingMail(
  workspaceId: string,
  contactId: string,
  to: string,
  kind: MailKind,
  d: { title: string; start: Date; end: Date; joinUrl?: string | null; location?: string | null; token?: string; text?: string | null; when?: string },
) {
  const when = formatRange(d.start, d.end);
  const subject = { confirm: `Termin bestätigt: ${d.title}`, rescheduled: `Termin verschoben: ${d.title}`, cancelled: `Termin abgesagt: ${d.title}`, reminder: `Erinnerung: ${d.title} ${d.when ?? ""}`.trim() }[kind];
  const lines = [
    "Hallo,",
    "",
    {
      confirm: "vielen Dank für Ihre Buchung. Ihr Termin ist bestätigt:",
      rescheduled: "Ihr Termin wurde verschoben. Neuer Zeitpunkt:",
      cancelled: "Ihr Termin wurde abgesagt:",
      reminder: "wir erinnern Sie an Ihren Termin:",
    }[kind],
    "",
    d.title,
    `${when} (Zeitzone Europe/Berlin)`,
    kind !== "cancelled" && d.joinUrl ? `Video-Call: ${d.joinUrl}` : "",
    kind !== "cancelled" && d.location ? `Ort: ${d.location}` : "",
    kind === "confirm" && d.text ? `\n${d.text}` : "",
    "",
    kind !== "cancelled" && d.token ? `Termin umbuchen oder absagen: ${manageUrl(d.token)}` : "",
    kind !== "cancelled" && d.token ? `Kalendereintrag (.ics): ${manageUrl(d.token)}/ics` : "",
  ].filter((l, k, a) => !(l === "" && a[k - 1] === ""));
  try {
    await sendMail({ workspaceId, to, contactId, kind: "system", subject: subject.slice(0, 200), text: lines.join("\n") });
    return true;
  } catch (e) {
    if (!(e instanceof SuppressedError)) log.warn("booking mail failed", { kind, error: errMessage(e) });
    return false;
  }
}

// ---------- Verwaltung durch den Gast ----------

export async function eventByToken(token: string) {
  if (!isWellFormedToken(token)) return null;
  const ev = await db.event.findUnique({
    where: { bookingTokenHash: hashManageToken(env.appSecret(), token) },
    include: { meetingType: true, workspace: true, owner: { select: { id: true, name: true, email: true } } },
  });
  return ev && ev.source === "booking" ? ev : null;
}

function guestOf(ev: { attendees: Prisma.JsonValue }) {
  const a = ((ev.attendees ?? []) as { email?: string; contactId?: string }[]).find((x) => x.contactId && x.email);
  return a ? { email: a.email!, contactId: a.contactId! } : null;
}

export async function cancelByToken(token: string, reason: string) {
  const ev = await eventByToken(token);
  if (!ev) throw new BookingError("Dieser Link ist ungültig.");
  if (ev.status === "cancelled") return { already: true };
  if (ev.startsAt.getTime() < Date.now()) throw new BookingError("Vergangene Termine lassen sich nicht mehr absagen.");
  const why = neutralizePlaceholders(reason.trim().slice(0, 500));
  await cancelMeeting(ev.workspaceId, ev.id, "booking:guest", why ? `Abgesagt durch Gast: ${why}` : "Abgesagt durch Gast.");
  const g = guestOf(ev);
  if (g) {
    await sendBookingMail(ev.workspaceId, g.contactId, g.email, "cancelled", { title: ev.meetingType?.name ?? ev.title, start: ev.startsAt, end: ev.endsAt });
    await db.activity.create({ data: { workspaceId: ev.workspaceId, contactId: g.contactId, type: "SYSTEM", body: `Online-Buchung vom Gast abgesagt${why ? `: ${why}` : ""}`, meta: { eventId: ev.id } } });
  }
  return { already: false };
}

export async function rescheduleByToken(token: string, start: Date) {
  const ev = await eventByToken(token);
  if (!ev || !ev.meetingType || !ev.ownerId) throw new BookingError("Dieser Link ist ungültig.");
  if (ev.status !== "scheduled") throw new BookingError("Dieser Termin ist nicht mehr aktiv.");
  const mt = ev.meetingType;
  const day = utcToZonedLocal(start, parseAvailability(mt.availability).zeitzone).slice(0, 10);
  const slots = await availableSlots(ev.workspace, mt, { fromDay: day, toDay: day, onlyHostIds: [ev.ownerId], ignoreEventId: ev.id });
  const slot = slots.find((s) => s.start.getTime() === start.getTime());
  if (!slot) throw new BookingError("Diese Zeit ist leider nicht frei. Bitte wählen Sie eine andere.");
  const hold = await holdSlot(ev.workspace, mt, ev.ownerId, slot.start, slot.end, ev.id);
  if (!hold) throw new BookingError("Diese Zeit wurde gerade vergeben. Bitte wählen Sie eine andere.");
  try {
    await rescheduleMeeting(ev.workspaceId, ev.id, slot.start, mt.durationMin, "booking:guest");
  } finally {
    await db.event.deleteMany({ where: { id: hold.id, status: "held" } });
  }
  const g = guestOf(ev);
  if (g) {
    await sendBookingMail(ev.workspaceId, g.contactId, g.email, "rescheduled", { title: mt.name, start: slot.start, end: slot.end, joinUrl: ev.joinUrl, location: ev.location, token });
    await db.activity.create({ data: { workspaceId: ev.workspaceId, contactId: g.contactId, type: "SYSTEM", body: `Online-Buchung vom Gast verschoben auf ${formatRange(slot.start, slot.end)}`, meta: { eventId: ev.id } } });
  }
  return { start: slot.start, end: slot.end };
}

/** .ics zum Herunterladen (falls die Einladung nicht ankam) – gleiche UID wie die .ics-Einladung. */
export async function icsForToken(token: string) {
  const ev = await eventByToken(token);
  if (!ev || ev.status !== "scheduled" || !ev.owner) return null;
  return buildIcs({
    method: "REQUEST",
    uid: ev.icsUid ?? `${ev.id}@kundrio`,
    sequence: ev.icsSequence,
    start: ev.startsAt,
    end: ev.endsAt,
    summary: ev.title,
    description: ev.joinUrl ? `Video-Call: ${ev.joinUrl}` : null,
    location: ev.location ?? ev.joinUrl,
    url: ev.joinUrl,
    organizer: { email: ev.owner.email, name: ev.owner.name },
    attendees: [],
    reminders: [60],
  });
}

// ---------- Erinnerungen ----------

type ReminderState = { h24?: string; h1?: string };

/** Erinnerungen 24 h und 1 h vorher an Gäste von Online-Buchungen. Abgesagte/verschobene Termine werden beachtet. */
export async function sendDueReminders(now = new Date()) {
  // abgelaufene Reservierungen (Absturz während der Buchung) aufräumen
  await db.event.deleteMany({ where: { status: "held", createdAt: { lt: new Date(now.getTime() - HOLD_TTL_MS) } } });
  const events = await db.event.findMany({
    where: { source: "booking", status: "scheduled", startsAt: { gt: now, lte: new Date(now.getTime() + 24 * 3600_000) } },
    include: { meetingType: { select: { name: true } } },
    take: 500,
  });
  let sent = 0;
  for (const ev of events) {
    const refs = (ev.externalRefs ?? {}) as Record<string, unknown>;
    const state = (refs.bookingReminders ?? {}) as ReminderState;
    const key = ev.startsAt.toISOString(); // nach Umbuchung neu erinnern
    const left = ev.startsAt.getTime() - now.getTime();
    // 1 h vorher (Job läuft alle 15 min → Fenster 70 min); „morgen“ nur, wenn der Termin noch ≥ 20 h entfernt ist
    const which: keyof ReminderState | null =
      left <= 70 * 60_000 ? (state.h1 === key ? null : "h1") : left >= 20 * 3600_000 && state.h24 !== key ? "h24" : null;
    if (!which) continue;
    const g = guestOf(ev);
    if (!g) continue;
    // Zustand zuerst setzen (höchstens einmal senden, auch bei Wiederholung des Jobs)
    const next = { ...state, [which]: key, ...(which === "h1" ? { h24: state.h24 ?? key } : {}) };
    const claimed = await db.event.updateMany({
      where: { id: ev.id, updatedAt: ev.updatedAt },
      data: { externalRefs: { ...refs, bookingReminders: next } as Prisma.InputJsonValue },
    });
    if (claimed.count === 0) continue;
    const ok = await sendBookingMail(ev.workspaceId, g.contactId, g.email, "reminder", {
      title: ev.meetingType?.name ?? ev.title,
      start: ev.startsAt,
      end: ev.endsAt,
      joinUrl: ev.joinUrl,
      location: ev.location,
      when: which === "h1" ? "in einer Stunde" : "morgen",
    });
    if (ok) sent++;
  }
  return sent;
}

// ---------- Einwilligung aus der Buchung (Double-Opt-in) ----------

export async function confirmBookingConsent(contactId: string, key: string) {
  const mtId = key.startsWith("bk-") ? key.slice(3) : "";
  const c = await db.contact.findUnique({ where: { id: contactId }, select: { id: true, workspaceId: true } });
  if (!c || !mtId) return false;
  const mt = await db.meetingType.findFirst({ where: { id: mtId, workspaceId: c.workspaceId }, select: { id: true, name: true } });
  if (!mt) return false;
  const now = new Date();
  await db.$transaction([
    db.contact.update({ where: { id: c.id }, data: { consentEmailAt: now, consentSource: `DOI Online-Buchung „${mt.name}“ (${mt.id})`.slice(0, 300), unsubscribedAt: null } }),
    db.activity.create({ data: { workspaceId: c.workspaceId, contactId: c.id, type: "SYSTEM", body: "E-Mail-Einwilligung bestätigt (Double-Opt-in, Online-Buchung)", meta: { meetingTypeId: mt.id, at: now.toISOString() } } }),
  ]);
  return true;
}
