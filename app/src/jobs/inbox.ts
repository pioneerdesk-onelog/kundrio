import type { JobHandler } from "@/lib/jobs";
import { enqueue } from "@/lib/jobs";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import "@/lib/inbox/register";
import { getChannelAdapter } from "@/lib/inbox/channel";
import { openCredentials } from "@/lib/inbox/credentials";
import { ingestInbound } from "@/lib/inbox/ingest";
import { fetchEmailBatch, saveCursor } from "@/lib/inbox/channels/email-imap";

// Posteingang: alle 60 s abrufbare Kanäle (IMAP) abholen und zurückgestellte Gespräche wieder öffnen.
// Webhook-Kanäle (WhatsApp/SMS) liefern über ihre eigenen Routen direkt an ingestInbound.

const EVERY_MS = 60_000;

export async function ensureInboxPollScheduled() {
  const pending = await db.job.count({ where: { type: "inbox.poll", status: { in: ["queued", "running"] } } });
  if (pending === 0) await enqueue("inbox.poll", {}, { runAt: new Date(Date.now() + EVERY_MS) });
}

function isAuthError(e: unknown) {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return /auth|login|credential|passwort|password|invalid credentials|authenticationfailed/.test(m);
}

/** Ein Postfach abrufen; Fehler bleiben auf diesem Postfach (sichtbar in lastError). */
export async function pollInbox(inboxId: string) {
  const inbox = await db.inbox.findUnique({ where: { id: inboxId } });
  if (!inbox || !inbox.active) return null;
  const adapter = getChannelAdapter(inbox.provider);
  if (!adapter?.fetchNew) return null;
  const creds = openCredentials(inbox);
  try {
    let result;
    if (inbox.provider === "imap") {
      // Merker erst NACH der Übernahme speichern – sonst gingen Nachrichten bei einem Fehler verloren
      const batch = await fetchEmailBatch(inbox, creds);
      result = await ingestInbound(inbox.id, batch.messages);
      if (result.failed === 0) await saveCursor(inbox.id, batch.cursor);
    } else {
      result = await ingestInbound(inbox.id, await adapter.fetchNew(inbox, creds));
    }
    await db.inbox.update({ where: { id: inbox.id }, data: { lastSyncAt: new Date(), status: result.failed ? "error" : "ok", lastError: result.failed ? `${result.failed} Nachricht(en) konnten nicht übernommen werden` : null } });
    if (result.created) log.info("inbox.polled", { inboxId, created: result.created, duplicates: result.duplicates });
    return result;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await db.inbox.update({ where: { id: inbox.id }, data: { status: isAuthError(e) ? "reconnect" : "error", lastError: msg, lastSyncAt: new Date() } });
    log.warn("inbox.poll_failed", { inboxId, error: msg });
    return null;
  }
}

export const handlers: Record<string, JobHandler> = {
  "inbox.poll": async () => {
    try {
      // Zurückgestellte Gespräche wieder öffnen
      await db.conversation.updateMany({ where: { status: "snoozed", snoozedUntil: { lte: new Date() } }, data: { status: "open", snoozedUntil: null } });
      // Postfächer mit Status „reconnect“ nicht endlos versuchen – erst nach neuer Einrichtung
      const inboxes = await db.inbox.findMany({ where: { active: true, status: { not: "reconnect" } }, select: { id: true, provider: true } });
      for (const i of inboxes) {
        if (getChannelAdapter(i.provider)?.fetchNew) await pollInbox(i.id);
      }
    } finally {
      await ensureInboxPollScheduled();
    }
  },
  /** Einzelnes Postfach sofort abrufen (Knopf „Jetzt abrufen“) */
  "inbox.poll_one": async (p) => {
    await pollInbox(String(p.inboxId));
  },
};

export const onWorkerStart = ensureInboxPollScheduled;
