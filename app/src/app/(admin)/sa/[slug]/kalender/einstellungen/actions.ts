"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { guard } from "@/lib/permissions/guard";
import { listCalendarsFor } from "@/lib/calendar/service";

/** Teamkalender festlegen: Kalender aus einer eigenen Verbindung der handelnden Person (Recht Einstellungen). */
export async function setTeamCalendar(slug: string, fd: FormData) {
  const { ws, user } = await guard(slug, { special: "manage_settings" });
  const back = `/sa/${slug}/kalender/einstellungen`;
  const value = String(fd.get("calendar") ?? "");
  if (!value) redirect(`${back}?fehler=${encodeURIComponent("Bitte einen Kalender wählen.")}`);
  const [connectionId, calendarId] = value.split("|");
  const conn = await db.calendarConnection.findFirst({ where: { id: connectionId, userId: user.id, status: "active" } });
  if (!conn) redirect(`${back}?fehler=${encodeURIComponent("Verbindung nicht gefunden.")}`);
  const calendars = await listCalendarsFor(conn!.id, user.id);
  const cal = calendars.find((c) => c.id === calendarId);
  if (!cal) redirect(`${back}?fehler=${encodeURIComponent("Kalender nicht gefunden oder nicht beschreibbar.")}`);
  const team = { provider: conn!.provider, calendarId: cal!.id, connectionId: conn!.id, name: cal!.name, account: conn!.accountEmail };
  await db.workspace.update({ where: { id: ws.id }, data: { teamCalendar: team as Prisma.InputJsonValue } });
  await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "calendar.team_set", target: cal!.id, detail: { provider: conn!.provider } });
  redirect(`${back}?ok=${encodeURIComponent(`Teamkalender: ${cal!.name}`)}`);
}

export async function clearTeamCalendar(slug: string) {
  const { ws, user } = await guard(slug, { special: "manage_settings" });
  await db.workspace.update({ where: { id: ws.id }, data: { teamCalendar: Prisma.DbNull } });
  await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "calendar.team_cleared" });
  redirect(`/sa/${slug}/kalender/einstellungen?ok=${encodeURIComponent("Teamkalender entfernt.")}`);
}
