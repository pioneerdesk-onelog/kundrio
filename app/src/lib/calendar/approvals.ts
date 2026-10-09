import "server-only";
import { registerApprovalKind } from "../approvals";
import { scheduleMeeting } from "./meetings";
import type { VideoProvider } from "./config";

// Termine mit Einladung an Kunden haben Außenwirkung: Prozesse/MCP legen eine Freigabe an,
// ein Mensch bestätigt – erst dann werden Einladungen verschickt.
registerApprovalKind("meeting.schedule", "Termin mit Einladung an Kunden", async (p, ctx) => {
  const r = await scheduleMeeting(
    {
      workspaceId: ctx.workspaceId,
      organizerId: String(p.organizerId),
      meetingTypeId: (p.meetingTypeId as string | undefined) ?? null,
      title: (p.title as string | undefined) ?? null,
      description: (p.description as string | undefined) ?? null,
      start: new Date(String(p.start)),
      durationMin: typeof p.durationMin === "number" ? p.durationMin : null,
      videoProvider: (p.videoProvider as VideoProvider | undefined) ?? null,
      location: (p.location as string | undefined) ?? null,
      contactIds: Array.isArray(p.contactIds) ? p.contactIds.map(String) : [],
      internalUserIds: Array.isArray(p.internalUserIds) ? p.internalUserIds.map(String) : [],
      dealId: (p.dealId as string | undefined) ?? null,
    },
    ctx.decidedBy,
  );
  return { eventId: r.eventId, joinUrl: r.joinUrl, warnings: r.warnings };
});
