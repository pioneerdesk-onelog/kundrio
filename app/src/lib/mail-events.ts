import "server-only";
import { db } from "./db";
import { emitEvent } from "./events";
import { emitMailEvent } from "./webhook";
import type { RelayEvent } from "./mail-events-parse";
import { errMessage, log } from "@/lib/log";

export { parseBrevoEvent, type RelayEvent } from "./mail-events-parse";

// Ereignisse vom Versand-Relay (Übergangszeit: Brevo nur noch als SMTP-Relay) → EmailEvent, Status, Sperrliste.

const STATUS_FOR: Record<string, string> = {
  delivered: "delivered",
  soft_bounce: "soft_bounce",
  hard_bounce: "hard_bounce",
  blocked: "blocked",
  spam: "spam",
  invalid: "hard_bounce",
};

/** Ereignis übernehmen. Liefert false, wenn die Nachricht unbekannt ist (wird dann ignoriert). */
export async function applyRelayEvent(e: RelayEvent): Promise<boolean> {
  const msg = e.pdId
    ? await db.emailMessage.findUnique({ where: { id: e.pdId } })
    : e.messageIdHeader
      ? await db.emailMessage.findFirst({ where: { OR: [{ messageId: e.messageIdHeader }, { messageId: e.messageIdHeader.replace(/^<|>$/g, "") }] } })
      : null;
  if (!msg) return false;

  // Doppelte Zustellung desselben Ereignisses ignorieren – atomar je Nachricht, denn Relays wiederholen
  // auch gleichzeitig (LR-6: 10 parallele Zustellungen ergaben vorher 3 Ereignisse + Sperrlisten-Fehler)
  const fresh = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mail-event:${msg.id}`}))`;
    const dup = await tx.emailEvent.findFirst({ where: { messageId: msg.id, event: e.event, at: e.at, link: e.link }, select: { id: true } });
    if (dup) return false;
    await tx.emailEvent.create({ data: { workspaceId: msg.workspaceId, messageId: msg.id, event: e.event, reason: e.reason, link: e.link, at: e.at } });
    return true;
  });
  if (!fresh) return true;

  const status = STATUS_FOR[e.event];
  // „delivered“ überschreibt keinen schlechteren Status (z. B. späte Spam-Meldung)
  if (status && !(status === "delivered" && ["hard_bounce", "spam", "blocked"].includes(msg.status))) {
    await db.emailMessage.update({ where: { id: msg.id }, data: { status } });
  }

  // Harte Bounces, ungültige Adressen und Spam-Beschwerden sperren die Adresse für den Sub-Account
  if (e.event === "hard_bounce" || e.event === "spam" || e.event === "invalid") {
    // ON CONFLICT DO NOTHING: gleichzeitige Bounce-/Spam-Meldungen derselben Adresse dürfen nicht scheitern
    await db.suppression.createMany({
      data: [{ workspaceId: msg.workspaceId, email: e.email, reason: e.event === "spam" ? "spam" : "hard_bounce", source: "relay" }],
      skipDuplicates: true,
    });
  }
  // Abmeldung über den Relay-Link: nur Marketing sperren (Kontakt), nicht transaktional
  if (e.event === "unsubscribed") {
    await db.contact.updateMany({ where: { workspaceId: msg.workspaceId, email: e.email, unsubscribedAt: null }, data: { unsubscribedAt: e.at } });
  }

  // Prozess-Engine: Ereignis in die Outbox (Auslöser „E-Mail-Ereignis“), nur mit zugeordnetem Kontakt
  const contactId =
    msg.contactId ?? (await db.contact.findFirst({ where: { workspaceId: msg.workspaceId, email: e.email }, select: { id: true } }))?.id;
  if (contactId) {
    await emitEvent({
      workspaceId: msg.workspaceId,
      type: "email.event",
      objectType: "contact",
      objectId: contactId,
      data: { event: e.event, emailMessageId: msg.id, reason: e.reason ?? null },
    }).catch((err) => log.error("outbox write failed", { type: "email.event", error: errMessage(err) }));
  }

  await emitMailEvent(msg.workspaceId, msg.kind === "campaign" ? "marketing" : "transactional", {
    event: e.event,
    email: e.email,
    messageId: msg.messageId,
    emailMessageId: msg.id,
    subject: msg.subject,
    tags: msg.tags,
    reason: e.reason,
    link: e.link,
    at: e.at,
  });
  return true;
}
