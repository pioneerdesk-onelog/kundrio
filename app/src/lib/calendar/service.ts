import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import type { Provider } from "./config";
import { accessTokenFor, activeConnection } from "./connections";
import { suggestSlots, type Busy } from "./availability";
import { GOOGLE_RESPONSE, googleFreeBusy, googleGetEvent, googleListCalendars, meetLinkOf } from "./google";
import { GRAPH_RESPONSE, graphGetEvent, graphGetSchedule, graphListCalendars } from "./graph";
import type { Attendee, ExternalRefs } from "./meetings";

// Frei/Belegt, Terminvorschläge, Kalenderliste und Abgleich der Antworten.

/** Belegte Zeiten des Organisators aus seiner Kalender-Verbindung + CRM-Terminen. */
export async function busyFor(userId: string, from: Date, to: Date): Promise<{ busy: Busy[]; source: Provider | "crm" }> {
  const crm = await db.event.findMany({
    where: { ownerId: userId, status: "scheduled", startsAt: { lt: to }, endsAt: { gt: from } },
    select: { startsAt: true, endsAt: true },
  });
  const busy: Busy[] = crm.map((e) => ({ start: e.startsAt, end: e.endsAt }));
  const conn = (await activeConnection(userId, "google")) ?? (await activeConnection(userId, "microsoft"));
  if (!conn) return { busy, source: "crm" };
  const token = await accessTokenFor(conn);
  const ext = conn.provider === "google" ? await googleFreeBusy(token, conn.calendarId, from, to) : await graphGetSchedule(token, conn.accountEmail, from, to);
  return { busy: [...busy, ...ext], source: conn.provider as Provider };
}

export async function suggestFor(userId: string, durationMin: number, bufferMin: number, from = new Date()) {
  const start = new Date(Math.ceil(from.getTime() / 1800000) * 1800000 + 3600000); // frühestens in 1 h, auf halbe Stunde
  const to = new Date(start.getTime() + 14 * 864e5);
  const { busy, source } = await busyFor(userId, start, to);
  return { slots: suggestSlots(busy, { from: start, days: 14, durationMin, bufferMin, max: 8 }), source };
}

export async function listCalendarsFor(connectionId: string, userId: string) {
  const conn = await db.calendarConnection.findFirst({ where: { id: connectionId, userId, status: "active" } });
  if (!conn) throw new Error("Verbindung nicht gefunden.");
  const token = await accessTokenFor(conn);
  return conn.provider === "google" ? googleListCalendars(token) : graphListCalendars(token);
}

/**
 * Antwortstatus der Teilnehmenden für kommende, aus dem CRM erstellte Termine abgleichen
 * (Datenminimierung: nur eigene Termine, nur Antwortstatus).
 */
export async function syncResponses(limit = 200) {
  const events = await db.event.findMany({
    where: { status: "scheduled", startsAt: { gt: new Date(Date.now() - 3600000) }, NOT: { externalRefs: { equals: {} } } },
    orderBy: { startsAt: "asc" },
    take: limit,
  });
  let updated = 0;
  for (const ev of events) {
    const refs = (ev.externalRefs ?? {}) as ExternalRefs;
    const r = refs.organizer;
    if (!r) continue;
    try {
      const conn = await db.calendarConnection.findUnique({ where: { id: r.connectionId } });
      if (!conn || conn.status !== "active") continue;
      const token = await accessTokenFor(conn);
      const attendees = (ev.attendees ?? []) as Attendee[];
      let changed = false;
      let joinUrl = ev.joinUrl;
      let cancelled = false;
      if (r.provider === "google") {
        const g = await googleGetEvent(token, r.calendarId, r.eventId);
        cancelled = g.status === "cancelled";
        if (!joinUrl && ev.videoProvider === "google_meet") joinUrl = meetLinkOf(g);
        for (const a of attendees) {
          const resp = g.attendees?.find((x) => x.email.toLowerCase() === a.email)?.responseStatus;
          const label = resp ? (GOOGLE_RESPONSE[resp] ?? resp) : a.response;
          if (label && label !== a.response) {
            a.response = label;
            changed = true;
          }
        }
      } else {
        const m = await graphGetEvent(token, r.eventId);
        cancelled = Boolean(m.isCancelled);
        if (!joinUrl && ev.videoProvider === "ms_teams") joinUrl = m.onlineMeeting?.joinUrl ?? null;
        for (const a of attendees) {
          const resp = m.attendees?.find((x) => x.emailAddress?.address?.toLowerCase() === a.email)?.status?.response;
          const label = resp ? (GRAPH_RESPONSE[resp] ?? resp) : a.response;
          if (label && label !== a.response) {
            a.response = label;
            changed = true;
          }
        }
      }
      if (changed || joinUrl !== ev.joinUrl || cancelled) {
        await db.event.update({
          where: { id: ev.id },
          data: { attendees: attendees as unknown as Prisma.InputJsonValue, joinUrl, ...(cancelled ? { status: "cancelled" } : {}) },
        });
        updated++;
      }
    } catch {
      // einzelne Fehler (z. B. gelöschter Termin) blockieren den Abgleich nicht
    }
  }
  return updated;
}
