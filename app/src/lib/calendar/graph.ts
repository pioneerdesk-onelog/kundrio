// Microsoft Graph – Outlook-Termine mit Teams-Besprechung, Frei/Belegt, Kalenderliste.
// Doku: learn.microsoft.com/graph/outlook-calendar-online-meetings (isOnlineMeeting=true,
// onlineMeetingProvider=teamsForBusiness, Link in onlineMeeting.joinUrl), calendar-getschedule.
// Teilnehmende erhalten die Einladung automatisch von Exchange, sobald attendees gesetzt sind.

import { TIME_ZONE, calendarEnv } from "./config";
import { utcToZonedLocal } from "./time";
import type { Busy } from "./availability";
import type { MeetingPayloadInput } from "./google";

export function toGraphEvent(i: Omit<MeetingPayloadInput, "withMeet"> & { withTeams: boolean }) {
  const body = [i.description ?? "", i.joinUrl && !i.withTeams ? `Video-Link: ${i.joinUrl}` : ""].filter(Boolean).join("\n\n");
  return {
    subject: i.title,
    body: { contentType: "text", content: body },
    start: { dateTime: utcToZonedLocal(i.start), timeZone: TIME_ZONE },
    end: { dateTime: utcToZonedLocal(i.end), timeZone: TIME_ZONE },
    location: { displayName: i.location ?? (i.joinUrl && !i.withTeams ? i.joinUrl : "") },
    attendees: i.attendees.map((a) => ({ emailAddress: { address: a.email, name: a.name ?? a.email }, type: "required" })),
    allowNewTimeProposals: true,
    isReminderOn: Boolean(i.reminders?.length),
    reminderMinutesBeforeStart: i.reminders?.[i.reminders.length - 1] ?? 15,
    ...(i.withTeams ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
  };
}

type GraphEvent = {
  id: string;
  webLink?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  attendees?: { emailAddress?: { address?: string }; status?: { response?: string } }[];
  isCancelled?: boolean;
};

export function teamsLinkOf(e: GraphEvent): string | null {
  return e.onlineMeeting?.joinUrl ?? null;
}

async function mfetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${calendarEnv.msGraphBase()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      Prefer: `outlook.timezone="${TIME_ZONE === "Europe/Berlin" ? "W. Europe Standard Time" : "UTC"}"`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 202 || res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) throw new Error(`Microsoft Graph: ${data.error?.message ?? data.error?.code ?? `HTTP ${res.status}`}`.slice(0, 300));
  return data;
}

const enc = encodeURIComponent;
const eventsPath = (calendarId: string) => (calendarId === "primary" ? "/me/events" : `/me/calendars/${enc(calendarId)}/events`);

export async function graphCreateEvent(token: string, calendarId: string, body: object) {
  return mfetch<GraphEvent>(token, eventsPath(calendarId), { method: "POST", body: JSON.stringify(body) });
}

export async function graphUpdateEvent(token: string, eventId: string, body: object) {
  return mfetch<GraphEvent>(token, `/me/events/${enc(eventId)}`, { method: "PATCH", body: JSON.stringify(body) });
}

/** Absage durch den Organisator: verschickt Absagen an alle Teilnehmenden. */
export async function graphCancelEvent(token: string, eventId: string, comment: string) {
  await mfetch<void>(token, `/me/events/${enc(eventId)}/cancel`, { method: "POST", body: JSON.stringify({ comment }) });
}

/** Für Kopien ohne Teilnehmende (Teamkalender): einfach löschen. */
export async function graphDeleteEvent(token: string, eventId: string) {
  await mfetch<void>(token, `/me/events/${enc(eventId)}`, { method: "DELETE" });
}

export async function graphGetEvent(token: string, eventId: string) {
  return mfetch<GraphEvent>(token, `/me/events/${enc(eventId)}?$select=id,attendees,isCancelled,onlineMeeting`);
}

export async function graphGetSchedule(token: string, email: string, from: Date, to: Date): Promise<Busy[]> {
  const data = await mfetch<{ value?: { scheduleItems?: { status?: string; start: { dateTime: string }; end: { dateTime: string } }[] }[] }>(token, `/me/calendar/getSchedule`, {
    method: "POST",
    headers: { Prefer: 'outlook.timezone="UTC"' },
    body: JSON.stringify({
      schedules: [email],
      startTime: { dateTime: from.toISOString().slice(0, 19), timeZone: "UTC" },
      endTime: { dateTime: to.toISOString().slice(0, 19), timeZone: "UTC" },
      availabilityViewInterval: 30,
    }),
  });
  return (data.value?.[0]?.scheduleItems ?? [])
    .filter((s) => s.status !== "free" && s.status !== "workingElsewhere")
    .map((s) => ({ start: new Date(`${s.start.dateTime.replace(/\.\d+$/, "")}Z`), end: new Date(`${s.end.dateTime.replace(/\.\d+$/, "")}Z`) }));
}

export async function graphListCalendars(token: string) {
  const data = await mfetch<{ value?: { id: string; name: string; canEdit?: boolean; isDefaultCalendar?: boolean }[] }>(token, `/me/calendars?$select=id,name,canEdit,isDefaultCalendar`);
  return (data.value ?? []).filter((c) => c.canEdit !== false).map((c) => ({ id: c.id, name: c.name, primary: Boolean(c.isDefaultCalendar) }));
}

export async function graphMe(token: string) {
  return mfetch<{ mail?: string | null; userPrincipalName?: string }>(token, `/me?$select=mail,userPrincipalName`);
}

export const GRAPH_RESPONSE: Record<string, string> = { accepted: "zugesagt", declined: "abgesagt", tentativelyAccepted: "vielleicht", none: "offen", notResponded: "offen", organizer: "Organisator" };
