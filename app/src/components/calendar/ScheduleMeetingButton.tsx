import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, getAccess, scopeWhere } from "@/lib/permissions";
import { ensureDefaultMeetingTypes } from "@/lib/calendar/defaults";
import { ownerOptions } from "@/lib/objects/defaults";
import { contactName } from "@/lib/a-format";
import { scheduleMeetingAction, suggestSlotsAction } from "@/app/(admin)/sa/[slug]/kalender/actions";
import { MeetingDialog } from "./MeetingDialog";

/**
 * „Termin mit Video-Call“ – für Kalender, Kontakt-, Deal- und Ticket-Detailseiten.
 * Lädt Vorlagen, Kontakte (in Reichweite), Kolleginnen und Verbindungsstatus selbst.
 * Ohne Recht tasks.edit wird nichts angezeigt.
 */
export async function ScheduleMeetingButton({
  slug,
  workspaceId,
  contactIds = [],
  dealId = null,
  label,
}: {
  slug: string;
  workspaceId: string;
  contactIds?: string[];
  dealId?: string | null;
  ticketId?: string | null;
  label?: string;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  const access = await getAccess(user.id, workspaceId);
  if (!access || !can(access, "tasks", "edit")) return null;
  await ensureDefaultMeetingTypes(workspaceId);
  const [types, contacts, owners, conns, ws] = await Promise.all([
    db.meetingType.findMany({ where: { workspaceId, active: true }, orderBy: { name: "asc" } }),
    db.contact.findMany({
      where: { workspaceId, email: { not: null }, ...(scopeWhere(access, "contacts") as object) },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
    ownerOptions(workspaceId),
    db.calendarConnection.findMany({ where: { userId: user.id, status: "active" }, select: { provider: true } }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { teamCalendar: true } }),
  ]);
  // vorgewählte Kontakte immer in der Liste, sofern in Reichweite
  const missing = contactIds.filter((id) => !contacts.some((c) => c.id === id));
  const extra = missing.length
    ? await db.contact.findMany({ where: { id: { in: missing }, workspaceId, ...(scopeWhere(access, "contacts") as object) }, select: { id: true, firstName: true, lastName: true, email: true } })
    : [];
  const all = [...extra, ...contacts];
  return (
    <MeetingDialog
      label={label}
      action={scheduleMeetingAction.bind(null, slug)}
      suggest={suggestSlotsAction.bind(null, slug)}
      types={types.map((t) => ({ id: t.id, name: t.name, durationMin: t.durationMin, bufferMin: t.bufferMin, videoProvider: t.videoProvider, addToTeamCalendar: t.addToTeamCalendar }))}
      contacts={all.map((c) => ({ id: c.id, label: `${contactName(c)}${c.email ? ` <${c.email}>` : ""}` }))}
      colleagues={owners.filter((o) => o.id !== user.id).map((o) => ({ id: o.id, label: o.name }))}
      preselectedContactIds={contactIds.filter((id) => all.some((c) => c.id === id))}
      dealId={dealId}
      connected={{ google: conns.some((c) => c.provider === "google"), microsoft: conns.some((c) => c.provider === "microsoft") }}
      hasTeamCalendar={Boolean(ws?.teamCalendar)}
    />
  );
}
