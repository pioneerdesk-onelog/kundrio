import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { enqueue } from "./jobs";
import { evaluateTrust, type TrustInput } from "./trust";
import { errMessage, log } from "@/lib/log";

/**
 * Bewertet einen Kontakt (ohne Netzprüfung), speichert Score + Signale und stößt die MX-Prüfung an.
 * Darf nie werfen: Fehler hier dürfen keine Einsendung verhindern.
 */
export async function scoreContact(contactId: string, input: TrustInput) {
  try {
    const { score, signals } = evaluateTrust(input);
    const stored = { input: { ...input, mx: undefined }, signals, checkedAt: new Date().toISOString() };
    await db.contact.update({
      where: { id: contactId },
      data: { trustScore: score, trustSignals: stored as unknown as Prisma.InputJsonValue },
    });
    if (input.email) await enqueue("trust.score", { contactId });
  } catch (err) {
    log.error("lead trust scoring failed", { error: errMessage(err) });
  }
}

/** Anzahl der Formular-/Agent-Einsendungen eines Kontakts in der letzten Stunde. */
export async function recentSubmissions(contactId: string) {
  return db.activity.count({
    where: { contactId, type: "FORM", createdAt: { gte: new Date(Date.now() - 3600_000) } },
  });
}
