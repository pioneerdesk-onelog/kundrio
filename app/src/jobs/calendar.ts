import type { JobHandler } from "@/lib/jobs";
import { enqueue } from "@/lib/jobs";
import { db } from "@/lib/db";
import { syncResponses } from "@/lib/calendar/service";
import { sendDueReminders } from "@/lib/calendar/booking/service";

// Alle 15 Minuten: Antwortstatus/Meet-Link der kommenden CRM-Termine aus Google/Microsoft abgleichen
// und Erinnerungen (24 h / 1 h) an Gäste von Online-Buchungen senden.

const EVERY_MS = 15 * 60 * 1000;

export async function ensureCalendarSyncScheduled() {
  const pending = await db.job.count({ where: { type: "calendar.sync", status: "queued" } });
  if (pending === 0) await enqueue("calendar.sync", {}, { runAt: new Date(Date.now() + EVERY_MS) });
}

export const handlers: Record<string, JobHandler> = {
  "calendar.sync": async () => {
    const hasConnections = await db.calendarConnection.count({ where: { status: "active" } });
    if (hasConnections > 0) {
      const n = await syncResponses();
      if (n) console.log(`calendar.sync: ${n} Termin(e) aktualisiert`);
    }
    try {
      const r = await sendDueReminders();
      if (r) console.log(`calendar.sync: ${r} Buchungs-Erinnerung(en) gesendet`);
    } catch (e) {
      console.error("calendar.sync: Buchungs-Erinnerungen fehlgeschlagen", e instanceof Error ? e.message : e);
    }
    await ensureCalendarSyncScheduled();
  },
};

export const onWorkerStart = ensureCalendarSyncScheduled;
