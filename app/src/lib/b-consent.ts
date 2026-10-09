import "server-only";
import { db } from "./db";

/** Setzt die Abmeldung. Liefert false, wenn der Kontakt nicht (mehr) existiert. */
export async function unsubscribeContact(contactId: string, via: string): Promise<boolean> {
  const c = await db.contact.findUnique({ where: { id: contactId }, select: { id: true, workspaceId: true, unsubscribedAt: true } });
  if (!c) return false;
  if (!c.unsubscribedAt) {
    await db.$transaction([
      db.contact.update({ where: { id: c.id }, data: { unsubscribedAt: new Date() } }),
      db.activity.create({ data: { workspaceId: c.workspaceId, contactId: c.id, type: "SYSTEM", body: `E-Mail-Abmeldung (${via})` } }),
    ]);
  }
  return true;
}

/**
 * Bestätigt die Einwilligung (Double-Opt-in). Formular muss zum Workspace des Kontakts gehören.
 * Nachweis (Art. 7 Abs. 1 DSGVO): Zeitpunkt + Quelle am Kontakt, Wortlaut der Einwilligung in der Zeitleiste.
 */
export async function confirmConsent(contactId: string, formId: string): Promise<boolean> {
  const c = await db.contact.findUnique({ where: { id: contactId }, select: { id: true, workspaceId: true } });
  if (!c) return false;
  const form = await db.form.findFirst({ where: { id: formId, workspaceId: c.workspaceId }, select: { id: true, name: true, consentText: true } });
  if (!form) return false;
  const now = new Date();
  await db.$transaction([
    db.contact.update({
      where: { id: c.id },
      data: { consentEmailAt: now, consentSource: `DOI Formular „${form.name}“ (${form.id})`.slice(0, 300), unsubscribedAt: null },
    }),
    db.activity.create({
      data: { workspaceId: c.workspaceId, contactId: c.id, type: "SYSTEM", body: "E-Mail-Einwilligung bestätigt (Double-Opt-in)", meta: { formId: form.id, at: now.toISOString(), consentText: form.consentText } },
    }),
  ]);
  return true;
}
