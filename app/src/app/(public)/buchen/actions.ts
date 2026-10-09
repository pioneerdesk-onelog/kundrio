"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { rateLimitAsync } from "@/lib/ratelimit";
import { availableSlots, BookingError, bookSlot, cancelByToken, eventByToken, loadBookingPage, rescheduleByToken } from "@/lib/calendar/booking/service";
import { parseQuestions } from "@/lib/calendar/booking/rules";
import { log, errMessage } from "@/lib/log";

export type SlotDto = { start: string; end: string };
export type BookState = { error?: string };

async function limited(key: string, limit: number, windowMs: number) {
  const ip = clientIp(await headers());
  return !(await rateLimitAsync(`${key}:${ip}`, limit, windowMs));
}

/** Freie Zeiten einer öffentlichen Buchungsseite (ohne Gastgeber-Daten). */
export async function loadSlots(wsSlug: string, bookingSlug: string): Promise<{ slots: SlotDto[]; error?: string }> {
  if (await limited("booking-slots", 60, 60_000)) return { slots: [], error: "Zu viele Anfragen. Bitte kurz warten." };
  const page = await loadBookingPage(wsSlug, bookingSlug);
  if (!page) return { slots: [], error: "Diese Buchungsseite gibt es nicht (mehr)." };
  try {
    const slots = await availableSlots(page.ws, page.mt);
    return { slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) };
  } catch (e) {
    log.error("booking slots failed", { error: errMessage(e) });
    return { slots: [], error: "Freie Zeiten konnten nicht geladen werden. Bitte später erneut versuchen." };
  }
}

const text = (max: number) => z.string().trim().max(max);
const guestSchema = z.object({
  start: z.iso.datetime(),
  firstName: text(100).min(1, "Bitte Vornamen angeben"),
  lastName: text(100).min(1, "Bitte Nachnamen angeben"),
  email: z.email("Bitte gültige E-Mail-Adresse angeben").max(200),
  phone: text(40).regex(/^[0-9+()\/\s-]*$/, "Telefonnummer enthält ungültige Zeichen").optional(),
  company: text(200).optional(),
});

/** Öffentliche Buchung. Bei Erfolg Weiterleitung zur Bestätigungs-/Verwaltungsseite. */
export async function bookAction(wsSlug: string, bookingSlug: string, _prev: BookState, fd: FormData): Promise<BookState> {
  if (String(fd.get("website_url") ?? "") !== "") return { error: "Die Buchung konnte nicht abgeschlossen werden." }; // Honeypot
  if (await limited("booking", 10, 10 * 60_000)) return { error: "Zu viele Buchungsversuche. Bitte später erneut versuchen." };
  const page = await loadBookingPage(wsSlug, bookingSlug);
  if (!page) return { error: "Diese Buchungsseite gibt es nicht (mehr)." };
  const p = guestSchema.safeParse({
    start: fd.get("start"),
    firstName: fd.get("firstName"),
    lastName: fd.get("lastName"),
    email: fd.get("email"),
    phone: fd.get("phone") || undefined,
    company: fd.get("company") || undefined,
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Bitte Eingaben prüfen." };
  if (fd.get("privacy") !== "on") return { error: "Bitte bestätigen Sie den Datenschutzhinweis." };
  const answers: Record<string, string> = {};
  for (const q of parseQuestions(page.mt.questions)) {
    const v = String(fd.get(`q_${q.key}`) ?? "").trim().slice(0, q.type === "textarea" ? 2000 : 300);
    if (q.required && !v) return { error: `Bitte beantworten: ${q.label}` };
    if (v) answers[q.key] = v;
  }
  let token: string;
  try {
    const h = await headers();
    const r = await bookSlot({
      ws: page.ws,
      mt: page.mt,
      start: new Date(p.data.start),
      guest: { firstName: p.data.firstName, lastName: p.data.lastName, email: p.data.email, phone: p.data.phone ?? null, company: p.data.company ?? null },
      answers,
      newsletterConsent: fd.get("newsletter") === "on",
      formTs: typeof fd.get("_ts") === "string" ? (fd.get("_ts") as string) : null,
      userAgent: h.get("user-agent"),
    });
    token = r.token;
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    log.error("booking failed", { error: errMessage(e) });
    return { error: "Die Buchung ist leider fehlgeschlagen. Bitte versuchen Sie es erneut." };
  }
  redirect(`/buchen/termin/${token}?neu=1`);
}

/** Freie Zeiten zum Umbuchen (nur beim selben Gastgeber). */
export async function loadRescheduleSlots(token: string): Promise<{ slots: SlotDto[]; error?: string }> {
  if (await limited("booking-slots", 60, 60_000)) return { slots: [], error: "Zu viele Anfragen. Bitte kurz warten." };
  const ev = await eventByToken(token);
  if (!ev || !ev.meetingType || !ev.ownerId || ev.status !== "scheduled") return { slots: [], error: "Dieser Link ist ungültig." };
  const slots = await availableSlots(ev.workspace, ev.meetingType, { onlyHostIds: [ev.ownerId], ignoreEventId: ev.id });
  return { slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) };
}

export async function rescheduleAction(token: string, _prev: BookState, fd: FormData): Promise<BookState> {
  if (await limited("booking-manage", 20, 10 * 60_000)) return { error: "Zu viele Versuche. Bitte später erneut versuchen." };
  const start = z.iso.datetime().safeParse(fd.get("start"));
  if (!start.success) return { error: "Bitte eine neue Zeit wählen." };
  try {
    await rescheduleByToken(token, new Date(start.data));
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    log.error("booking reschedule failed", { error: errMessage(e) });
    return { error: "Umbuchen ist fehlgeschlagen. Bitte erneut versuchen." };
  }
  redirect(`/buchen/termin/${token}?verschoben=1`);
}

export async function cancelAction(token: string, _prev: BookState, fd: FormData): Promise<BookState> {
  if (await limited("booking-manage", 20, 10 * 60_000)) return { error: "Zu viele Versuche. Bitte später erneut versuchen." };
  try {
    await cancelByToken(token, String(fd.get("reason") ?? ""));
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    log.error("booking cancel failed", { error: errMessage(e) });
    return { error: "Absagen ist fehlgeschlagen. Bitte erneut versuchen." };
  }
  redirect(`/buchen/termin/${token}?abgesagt=1`);
}
