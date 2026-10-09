"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { forbiddenToState, guard } from "@/lib/permissions/guard";
import { requireUser } from "@/lib/auth";
import { cancelMeeting, MeetingError, rescheduleMeeting, scheduleMeeting } from "@/lib/calendar/meetings";
import { suggestFor } from "@/lib/calendar/service";
import { formatRange, toDatetimeLocal, zonedLocalToUtc } from "@/lib/calendar/time";

const date = z.string().min(1, "Datum fehlt").transform((v, ctx) => {
  // datetime-local = Ortszeit Europe/Berlin (unabhängig von der Server-Zeitzone)
  const d = zonedLocalToUtc(v) ?? new Date(NaN);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: "custom", message: "Ungültiges Datum" });
    return z.NEVER;
  }
  return d;
});

// Termine haben keine Zuständige: Recht über „Aufgaben & Kalender“, Sichtbarkeit zusätzlich über den verknüpften Kontakt.
export async function createEvent(slug: string, fd: FormData) {
  const { ws, access, user } = await guard(slug, { object: "tasks", action: "edit" });
  const data = z
    .object({
      title: z.string().trim().min(1, "Titel fehlt").max(200),
      startsAt: date,
      endsAt: z.string().optional(),
      location: z.string().trim().max(200).optional().transform((v) => v || null),
      contactId: z.string().optional().transform((v) => v || null),
    })
    .parse({
      title: fd.get("title"),
      startsAt: fd.get("startsAt"),
      endsAt: fd.get("endsAt") || undefined,
      location: fd.get("location") || undefined,
      contactId: fd.get("contactId") || undefined,
    });

  let endsAt = data.endsAt ? (zonedLocalToUtc(data.endsAt) ?? new Date(NaN)) : new Date(data.startsAt.getTime() + 3600 * 1000);
  if (Number.isNaN(endsAt.getTime()) || endsAt <= data.startsAt) endsAt = new Date(data.startsAt.getTime() + 3600 * 1000);

  if (data.contactId) {
    const ok = await db.contact.findFirst({ where: { id: data.contactId, workspaceId: ws.id }, select: { id: true, ownerId: true } });
    if (!ok || !can(access, "contacts", "read", ok.ownerId)) throw new Error("Kontakt nicht gefunden");
  }
  await db.event.create({
    data: { workspaceId: ws.id, title: data.title, startsAt: data.startsAt, endsAt, location: data.location, contactId: data.contactId, ownerId: user.id },
  });
  if (data.contactId) {
    await db.activity.create({
      data: { workspaceId: ws.id, contactId: data.contactId, type: "SYSTEM", body: `Termin: ${data.title}` },
    });
  }
  revalidatePath(`/sa/${slug}/kalender`);
}

export async function deleteEvent(slug: string, eventId: string) {
  const { ws, access } = await guard(slug, { object: "tasks", action: "delete" });
  const ev = await db.event.findFirst({ where: { id: eventId, workspaceId: ws.id }, select: { contact: { select: { ownerId: true } } } });
  if (!ev) return;
  if (ev.contact && !can(access, "contacts", "read", ev.contact.ownerId)) throw new Error("Termin nicht gefunden");
  await db.event.deleteMany({ where: { id: eventId, workspaceId: ws.id } });
  revalidatePath(`/sa/${slug}/kalender`);
}

// ---------- Termine mit Video-Call (Google Meet / Microsoft Teams / Jitsi + .ics) ----------

export type MeetingState = { error?: string; ok?: string; joinUrl?: string | null; warnings?: string[] };

const scheduleSchema = z.object({
  meetingTypeId: z.string().max(40).optional().transform((v) => v || null),
  title: z.string().trim().max(200).optional().transform((v) => v || null),
  description: z.string().max(5000).optional().transform((v) => (v && v.trim() ? v : null)),
  start: z.string().min(1, "Beginn fehlt"),
  durationMin: z.coerce.number().int().min(5).max(600).optional(),
  videoProvider: z.enum(["google_meet", "ms_teams", "jitsi", "opentalk", "phone", "onsite", "none"]),
  location: z.string().trim().max(300).optional().transform((v) => v || null),
  contactIds: z.array(z.string().max(40)).max(20),
  internalUserIds: z.array(z.string().max(40)).max(20),
  dealId: z.string().max(40).optional().transform((v) => v || null),
  addToTeamCalendar: z.boolean(),
});

/** Termin anlegen: Organisator = angemeldete Person. Einladungen gehen sofort raus (Außenwirkung durch Menschen mit tasks.edit). */
export async function scheduleMeetingAction(slug: string, _prev: MeetingState, fd: FormData): Promise<MeetingState> {
  try {
    const { ws, access, user } = await guard(slug, { object: "tasks", action: "edit" });
    const p = scheduleSchema.safeParse({
      meetingTypeId: fd.get("meetingTypeId") || undefined,
      title: fd.get("title") || undefined,
      description: fd.get("description") ?? undefined,
      start: fd.get("start"),
      durationMin: fd.get("durationMin") || undefined,
      videoProvider: fd.get("videoProvider"),
      location: fd.get("location") || undefined,
      contactIds: fd.getAll("contactIds").map(String).filter(Boolean),
      internalUserIds: fd.getAll("internalUserIds").map(String).filter(Boolean),
      dealId: fd.get("dealId") || undefined,
      addToTeamCalendar: fd.get("addToTeamCalendar") === "on",
    });
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingaben prüfen" };
    const start = zonedLocalToUtc(p.data.start);
    if (!start) return { error: "Ungültiger Beginn" };
    if (start.getTime() < Date.now() - 5 * 60000) return { error: "Der Beginn liegt in der Vergangenheit." };
    if (p.data.contactIds.length === 0 && p.data.internalUserIds.length === 0) return { error: "Bitte mindestens eine teilnehmende Person wählen." };
    // Reichweite: nur Kontakte/Deals, die die Person sehen darf
    for (const id of p.data.contactIds) {
      const c = await db.contact.findFirst({ where: { id, workspaceId: ws.id }, select: { ownerId: true } });
      if (!c || !can(access, "contacts", "read", c.ownerId)) return { error: "Ein Kontakt wurde nicht gefunden." };
    }
    if (p.data.dealId) {
      const d = await db.deal.findFirst({ where: { id: p.data.dealId, workspaceId: ws.id }, select: { ownerId: true } });
      if (!d || !can(access, "deals", "read", d.ownerId)) return { error: "Deal nicht gefunden." };
    }
    const r = await scheduleMeeting({ ...p.data, workspaceId: ws.id, organizerId: user.id, start }, `user:${user.id}`);
    revalidatePath(`/sa/${slug}/kalender`);
    for (const id of p.data.contactIds) revalidatePath(`/sa/${slug}/kontakte/${id}`);
    return { ok: "Termin angelegt, Einladungen sind verschickt.", joinUrl: r.joinUrl, warnings: r.warnings };
  } catch (e) {
    const f = forbiddenToState(e);
    if (f) return f;
    if (e instanceof MeetingError) return { error: e.message };
    return { error: e instanceof Error ? e.message.slice(0, 300) : "Termin konnte nicht angelegt werden." };
  }
}

/** Terminvorschläge aus Frei/Belegt der angemeldeten Person. */
export async function suggestSlotsAction(slug: string, durationMin: number, bufferMin: number) {
  await guard(slug, { object: "tasks", action: "edit" });
  const user = await requireUser();
  try {
    const { slots, source } = await suggestFor(user.id, Math.min(Math.max(durationMin, 5), 600), Math.min(Math.max(bufferMin, 0), 120));
    return { source, slots: slots.map((s) => ({ value: toDatetimeLocal(s.start), label: formatRange(s.start, s.end) })) };
  } catch (e) {
    return { source: "crm" as const, slots: [], error: e instanceof Error ? e.message.slice(0, 200) : "Frei/Belegt nicht abrufbar" };
  }
}

export async function cancelMeetingAction(slug: string, eventId: string, fd: FormData) {
  const { ws, access, user } = await guard(slug, { object: "tasks", action: "edit" });
  const ev = await db.event.findFirst({ where: { id: eventId, workspaceId: ws.id }, select: { ownerId: true, contact: { select: { ownerId: true } } } });
  if (!ev) throw new Error("Termin nicht gefunden");
  if (ev.contact && !can(access, "contacts", "read", ev.contact.ownerId)) throw new Error("Termin nicht gefunden");
  // Absagen darf der Organisator oder wer Termine löschen darf
  if (ev.ownerId !== user.id && !can(access, "tasks", "delete")) throw new Error("Nur der Organisator kann diesen Termin absagen.");
  await cancelMeeting(ws.id, eventId, `user:${user.id}`, String(fd.get("reason") ?? "").slice(0, 500));
  revalidatePath(`/sa/${slug}/kalender`);
}

export async function rescheduleMeetingAction(slug: string, eventId: string, _prev: MeetingState, fd: FormData): Promise<MeetingState> {
  try {
    const { ws, access, user } = await guard(slug, { object: "tasks", action: "edit" });
    const ev = await db.event.findFirst({ where: { id: eventId, workspaceId: ws.id }, select: { ownerId: true } });
    if (!ev) return { error: "Termin nicht gefunden" };
    if (ev.ownerId !== user.id && !can(access, "tasks", "delete")) return { error: "Nur der Organisator kann diesen Termin verschieben." };
    const start = zonedLocalToUtc(String(fd.get("start") ?? ""));
    if (!start) return { error: "Ungültiger Beginn" };
    const dur = Number(fd.get("durationMin") || 0) || null;
    const r = await rescheduleMeeting(ws.id, eventId, start, dur, `user:${user.id}`);
    revalidatePath(`/sa/${slug}/kalender`);
    return r.errors.length ? { ok: "Verschoben – mit Hinweisen.", warnings: r.errors } : { ok: "Termin verschoben, Teilnehmende sind informiert." };
  } catch (e) {
    const f = forbiddenToState(e);
    if (f) return f;
    return { error: e instanceof Error ? e.message.slice(0, 300) : "Verschieben fehlgeschlagen." };
  }
}
