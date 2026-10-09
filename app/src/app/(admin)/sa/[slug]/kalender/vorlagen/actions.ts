"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { forbiddenToState, guard } from "@/lib/permissions/guard";
import { unknownPlaceholders } from "@/lib/calendar/template";
import { VIDEO_PROVIDERS } from "@/lib/calendar/config";
import type { Prisma } from "@prisma/client";
import { BOOKING_SLUG_RE, parseRangesText, serializeAvailability, isValidTimeZone, WEEKDAYS, type Range, type Weekday } from "@/lib/calendar/booking/rules";
import { isValidOwner } from "@/lib/objects/defaults";


export type TplState = { error?: string; ok?: string };

const schema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(80),
  titleTemplate: z.string().trim().min(1, "Titel fehlt").max(200),
  description: z.string().max(5000).optional().transform((v) => (v && v.trim() ? v : null)),
  durationMin: z.coerce.number().int().min(5, "mind. 5 Minuten").max(600),
  bufferMin: z.coerce.number().int().min(0).max(120),
  videoProvider: z.enum(VIDEO_PROVIDERS),
  location: z.string().trim().max(300).optional().transform((v) => v || null),
  reminders: z
    .string()
    .optional()
    .transform((v) => (v ?? "").split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 10080).slice(0, 5)),
  addToTeamCalendar: z.boolean(),
  active: z.boolean(),
});

/** Anlegen bzw. ändern (id gesetzt). Vorlagen verwalten = Einstellungen des Sub-Accounts. */
export async function saveMeetingType(slug: string, id: string | null, _prev: TplState, fd: FormData): Promise<TplState> {
  try {
    const { ws, user } = await guard(slug, { special: "manage_settings" });
    const p = schema.safeParse({
      name: fd.get("name"),
      titleTemplate: fd.get("titleTemplate"),
      description: fd.get("description") ?? undefined,
      durationMin: fd.get("durationMin"),
      bufferMin: fd.get("bufferMin") || 0,
      videoProvider: fd.get("videoProvider"),
      location: fd.get("location") || undefined,
      reminders: fd.get("reminders") ?? undefined,
      addToTeamCalendar: fd.get("addToTeamCalendar") === "on",
      active: fd.get("active") === "on",
    });
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingaben prüfen" };
    const bad = [...unknownPlaceholders(p.data.titleTemplate), ...unknownPlaceholders(p.data.description ?? "")];
    if (bad.length) return { error: `Unbekannte Platzhalter: ${[...new Set(bad)].join(", ")}` };
    if (id) {
      const r = await db.meetingType.updateMany({ where: { id, workspaceId: ws.id }, data: p.data });
      if (r.count === 0) return { error: "Vorlage nicht gefunden" };
    } else {
      const dup = await db.meetingType.findFirst({ where: { workspaceId: ws.id, name: p.data.name } });
      if (dup) return { error: "Eine Vorlage mit diesem Namen gibt es schon." };
      await db.meetingType.create({ data: { ...p.data, workspaceId: ws.id } });
    }
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: id ? "meeting_type.updated" : "meeting_type.created", target: id ?? p.data.name });
    revalidatePath(`/sa/${slug}/kalender/vorlagen`);
    return { ok: "Gespeichert." };
  } catch (e) {
    return forbiddenToState(e) ?? { error: e instanceof Error ? e.message.slice(0, 300) : "Speichern fehlgeschlagen" };
  }
}

export async function deleteMeetingType(slug: string, id: string) {
  const { ws, user } = await guard(slug, { special: "manage_settings" });
  // Vorhandene Termine behalten ihren Inhalt (meetingTypeId wird null)
  await db.meetingType.deleteMany({ where: { id, workspaceId: ws.id } });
  await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "meeting_type.deleted", target: id });
  revalidatePath(`/sa/${slug}/kalender/vorlagen`);
}

// ---------- Online-Buchung (öffentlicher Buchungskalender) ----------


const bookingSchema = z.object({
  bookingEnabled: z.boolean(),
  bookingSlug: z.string().trim().toLowerCase().max(60).refine((v) => v === "" || BOOKING_SLUG_RE.test(v), "Adresse: nur a–z, 0–9 und Bindestrich"),
  minNoticeHours: z.coerce.number().int().min(0, "Vorlauf ≥ 0").max(720),
  maxDaysAhead: z.coerce.number().int().min(1, "Zeitraum ≥ 1 Tag").max(90, "Zeitraum höchstens 90 Tage"),
  slotIntervalMin: z.coerce.number().int().min(5).max(240),
  zeitzone: z.string().trim().max(60),
  feiertage: z.boolean(),
  confirmationText: z.string().max(2000).optional().transform((v) => (v && v.trim() ? v.trim() : null)),
});

/** Buchungseinstellungen einer Vorlage speichern (Recht: Einstellungen). */
export async function saveBookingSettings(slug: string, id: string, _prev: TplState, fd: FormData): Promise<TplState> {
  try {
    const { ws, user } = await guard(slug, { special: "manage_settings" });
    const mt = await db.meetingType.findFirst({ where: { id, workspaceId: ws.id } });
    if (!mt) return { error: "Vorlage nicht gefunden" };
    const p = bookingSchema.safeParse({
      bookingEnabled: fd.get("bookingEnabled") === "on",
      bookingSlug: fd.get("bookingSlug") ?? "",
      minNoticeHours: fd.get("minNoticeHours"),
      maxDaysAhead: fd.get("maxDaysAhead"),
      slotIntervalMin: fd.get("slotIntervalMin"),
      zeitzone: fd.get("zeitzone") || "Europe/Berlin",
      feiertage: fd.get("feiertage") === "on",
      confirmationText: fd.get("confirmationText") ?? undefined,
    });
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingaben prüfen" };
    if (!isValidTimeZone(p.data.zeitzone)) return { error: "Unbekannte Zeitzone" };
    if (p.data.bookingEnabled && !p.data.bookingSlug) return { error: "Für die öffentliche Buchung bitte eine Adresse angeben." };
    if (p.data.bookingEnabled && !ws.mailFromEmail) return { error: "Für die öffentliche Buchung zuerst eine Absenderadresse in den Einstellungen hinterlegen (Bestätigungen an Gäste)." };
    if (p.data.bookingSlug) {
      const dup = await db.meetingType.findFirst({ where: { workspaceId: ws.id, bookingSlug: p.data.bookingSlug, NOT: { id } } });
      if (dup) return { error: `Die Adresse „${p.data.bookingSlug}“ nutzt schon „${dup.name}“.` };
    }

    // Wochenzeiten
    const hours = {} as Record<Weekday, Range[]>;
    for (const d of WEEKDAYS) {
      const on = fd.get(`day_${d}`) === "on";
      const r = parseRangesText(String(fd.get(`hours_${d}`) ?? ""));
      if (on && r.error) return { error: `${d.toUpperCase()}: ${r.error}` };
      hours[d] = on ? r.ranges : [];
    }
    if (p.data.bookingEnabled && WEEKDAYS.every((d) => hours[d].length === 0)) return { error: "Bitte mindestens einen Tag mit Zeiten freigeben." };

    // Gastgeber (nur Personen mit Zugriff auf den Sub-Account)
    const hostUserIds: string[] = [];
    for (const v of fd.getAll("hostUserIds")) {
      const uid = String(v);
      if (uid && (await isValidOwner(ws.id, uid))) hostUserIds.push(uid);
    }

    // Zusatzfragen (bis zu 5)
    const questions: { key: string; label: string; type: "text" | "textarea"; required: boolean }[] = [];
    for (let k = 0; k < 5; k++) {
      const label = String(fd.get(`q_label_${k}`) ?? "").trim().slice(0, 200);
      if (!label) continue;
      questions.push({ key: `frage_${k + 1}`, label, type: fd.get(`q_type_${k}`) === "textarea" ? "textarea" : "text", required: fd.get(`q_req_${k}`) === "on" });
    }

    await db.meetingType.update({
      where: { id: mt.id },
      data: {
        bookingEnabled: p.data.bookingEnabled,
        bookingSlug: p.data.bookingSlug || null,
        minNoticeHours: p.data.minNoticeHours,
        maxDaysAhead: p.data.maxDaysAhead,
        slotIntervalMin: p.data.slotIntervalMin,
        confirmationText: p.data.confirmationText,
        availability: serializeAvailability({ hours, zeitzone: p.data.zeitzone, feiertage: p.data.feiertage }) as Prisma.InputJsonValue,
        hostUserIds,
        questions: questions as unknown as Prisma.InputJsonValue,
      },
    });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "meeting_type.booking_saved", target: mt.id, detail: { enabled: p.data.bookingEnabled } });
    revalidatePath(`/sa/${slug}/kalender/vorlagen`);
    return { ok: p.data.bookingEnabled ? "Gespeichert – öffentlich buchbar." : "Gespeichert (nicht öffentlich)." };
  } catch (e) {
    return forbiddenToState(e) ?? { error: e instanceof Error ? e.message.slice(0, 300) : "Speichern fehlgeschlagen" };
  }
}
