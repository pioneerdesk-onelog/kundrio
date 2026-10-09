// Google Calendar API v3 – Termine mit Google Meet, Frei/Belegt, Kalenderliste.
// Doku: developers.google.com/workspace/calendar/api (events.insert mit conferenceData.createRequest,
// Query conferenceDataVersion=1, sendUpdates=all|none; freeBusy.query).

import { randomBytes } from "node:crypto";
import { TIME_ZONE, calendarEnv } from "./config";
import { utcToZonedLocal } from "./time";
import type { Busy } from "./availability";

export type MeetingPayloadInput = {
  title: string;
  description?: string | null;
  location?: string | null;
  start: Date;
  end: Date;
  attendees: { email: string; name?: string | null }[];
  withMeet: boolean;
  reminders?: number[];
  /** fremder Video-Link (Jitsi/OpenTalk), wird in Ort/Beschreibung übernommen */
  joinUrl?: string | null;
};

/** Reines Mapping auf die Google-Event-Ressource. */
export function toGoogleEvent(i: MeetingPayloadInput) {
  const description = [i.description ?? "", i.joinUrl && !i.withMeet ? `Video-Link: ${i.joinUrl}` : ""].filter(Boolean).join("\n\n");
  return {
    summary: i.title,
    description: description || undefined,
    location: i.location ?? (i.joinUrl && !i.withMeet ? i.joinUrl : undefined),
    start: { dateTime: utcToZonedLocal(i.start), timeZone: TIME_ZONE },
    end: { dateTime: utcToZonedLocal(i.end), timeZone: TIME_ZONE },
    attendees: i.attendees.map((a) => ({ email: a.email, displayName: a.name ?? undefined })),
    reminders: i.reminders?.length
      ? { useDefault: false, overrides: i.reminders.slice(0, 5).map((m) => ({ method: "popup", minutes: m })) }
      : { useDefault: true },
    ...(i.withMeet
      ? { conferenceData: { createRequest: { requestId: randomBytes(9).toString("hex"), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : {}),
    guestsCanModify: false,
  };
}

type GEvent = {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
  status?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: { email: string; responseStatus?: string }[];
};

/** Meet-Link aus der Antwort (hangoutLink oder entryPoints[type=video]). */
export function meetLinkOf(e: GEvent): string | null {
  return e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null;
}

async function gfetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${calendarEnv.googleApiBase()}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) throw new Error(`Google Calendar: ${data.error?.message ?? `HTTP ${res.status}`}`.slice(0, 300));
  return data;
}

const enc = encodeURIComponent;

export async function googleInsertEvent(token: string, calendarId: string, body: object, notify: boolean) {
  const q = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: notify ? "all" : "none" });
  return gfetch<GEvent>(token, `/calendar/v3/calendars/${enc(calendarId)}/events?${q}`, { method: "POST", body: JSON.stringify(body) });
}

export async function googlePatchEvent(token: string, calendarId: string, eventId: string, body: object, notify: boolean) {
  const q = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: notify ? "all" : "none" });
  return gfetch<GEvent>(token, `/calendar/v3/calendars/${enc(calendarId)}/events/${enc(eventId)}?${q}`, { method: "PATCH", body: JSON.stringify(body) });
}

/** Absage: löschen mit sendUpdates=all verschickt Absagen an Teilnehmende. */
export async function googleDeleteEvent(token: string, calendarId: string, eventId: string, notify: boolean) {
  const q = new URLSearchParams({ sendUpdates: notify ? "all" : "none" });
  await gfetch<void>(token, `/calendar/v3/calendars/${enc(calendarId)}/events/${enc(eventId)}?${q}`, { method: "DELETE" });
}

export async function googleGetEvent(token: string, calendarId: string, eventId: string) {
  return gfetch<GEvent>(token, `/calendar/v3/calendars/${enc(calendarId)}/events/${enc(eventId)}`);
}

export async function googleFreeBusy(token: string, calendarId: string, from: Date, to: Date): Promise<Busy[]> {
  const data = await gfetch<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(token, `/calendar/v3/freeBusy`, {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: TIME_ZONE, items: [{ id: calendarId }] }),
  });
  const cal = data.calendars?.[calendarId] ?? Object.values(data.calendars ?? {})[0];
  return (cal?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export async function googleListCalendars(token: string) {
  const data = await gfetch<{ items?: { id: string; summary?: string; accessRole?: string; primary?: boolean }[] }>(token, `/calendar/v3/users/me/calendarList?minAccessRole=writer`);
  return (data.items ?? []).map((c) => ({ id: c.id, name: c.summary ?? c.id, primary: Boolean(c.primary) }));
}

export const GOOGLE_RESPONSE: Record<string, string> = { accepted: "zugesagt", declined: "abgesagt", tentative: "vielleicht", needsAction: "offen" };
