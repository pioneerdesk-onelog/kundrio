import "server-only";
import { db } from "../db";
import type { VideoProvider } from "./config";

// Standard-Terminvorlagen je Sub-Account (idempotent über den Namen).

export const DEFAULT_MEETING_TYPES: {
  name: string;
  titleTemplate: string;
  description: string;
  durationMin: number;
  bufferMin: number;
  videoProvider: VideoProvider;
  reminders: number[];
}[] = [
  {
    name: "Erstgespräch",
    titleTemplate: "Erstgespräch {{ company.name | default: \"\" }} – {{ meeting.workspace }}",
    description:
      "Hallo {{ contact.FIRSTNAME | default: \"zusammen\" }},\n\nvielen Dank für Ihr Interesse. In diesem kurzen Gespräch lernen wir uns kennen, klären Ihr Anliegen und die nächsten Schritte.\n\nVideo-Link: {{ meeting.joinUrl }}\n\nViele Grüße\n{{ owner.name }}",
    durationMin: 30,
    bufferMin: 10,
    videoProvider: "google_meet",
    reminders: [1440, 15],
  },
  {
    name: "Beratung",
    titleTemplate: "Beratung: {{ deal.title | default: \"Ihr Projekt\" }}",
    description:
      "Hallo {{ contact.FIRSTNAME | default: \"zusammen\" }},\n\nwie besprochen gehen wir Ihre Anforderungen im Detail durch. Bitte halten Sie relevante Unterlagen bereit.\n\nVideo-Link: {{ meeting.joinUrl }}\n\nViele Grüße\n{{ owner.name }}",
    durationMin: 60,
    bufferMin: 15,
    videoProvider: "ms_teams",
    reminders: [1440, 15],
  },
  {
    name: "Onboarding-Kickoff",
    titleTemplate: "Onboarding-Kickoff {{ company.name | default: \"\" }}",
    description:
      "Hallo {{ contact.FIRSTNAME | default: \"zusammen\" }},\n\nherzlich willkommen! Im Kickoff stimmen wir Ziele, Ansprechpartner und den Zeitplan ab.\n\nVideo-Link: {{ meeting.joinUrl }}\n\nViele Grüße\n{{ owner.name }}",
    durationMin: 45,
    bufferMin: 15,
    videoProvider: "google_meet",
    reminders: [1440, 60],
  },
  {
    name: "Support-Call",
    titleTemplate: "Support-Call {{ company.name | default: \"\" }}",
    description:
      "Hallo {{ contact.FIRSTNAME | default: \"zusammen\" }},\n\nwir schauen uns Ihr Anliegen gemeinsam an.\n\nVideo-Link: {{ meeting.joinUrl }}\n\nViele Grüße\n{{ owner.name }}",
    durationMin: 15,
    bufferMin: 5,
    videoProvider: "jitsi",
    reminders: [15],
  },
];

export async function ensureDefaultMeetingTypes(workspaceId: string) {
  const existing = await db.meetingType.count({ where: { workspaceId } });
  if (existing > 0) return;
  await db.meetingType.createMany({
    data: DEFAULT_MEETING_TYPES.map((t) => ({ ...t, workspaceId, addToTeamCalendar: true })),
    skipDuplicates: true,
  });
}
