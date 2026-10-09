import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import type { ChannelKind, ConsentState } from "./rules";

// Kanal-Einwilligungen und Abmeldungen am Kontakt.
// WhatsApp: whatsappConsentAt / whatsappOptOutAt (Spalten). SMS: smsConsentAt (Spalte); SMS-Abmeldung in
// attributes.SMS_OPT_OUT_AT (keine eigene Spalte im Schema).

export const SMS_OPT_OUT_ATTR = "SMS_OPT_OUT_AT";

type ContactConsentRow = {
  smsConsentAt: Date | null;
  whatsappConsentAt: Date | null;
  whatsappOptOutAt: Date | null;
  attributes: Prisma.JsonValue;
};

export function consentState(c: ContactConsentRow): ConsentState {
  const attrs = (c.attributes && typeof c.attributes === "object" && !Array.isArray(c.attributes) ? c.attributes : {}) as Record<string, unknown>;
  const smsOut = typeof attrs[SMS_OPT_OUT_ATTR] === "string" ? new Date(attrs[SMS_OPT_OUT_ATTR] as string) : null;
  return {
    smsConsentAt: c.smsConsentAt,
    whatsappConsentAt: c.whatsappConsentAt,
    whatsappOptOutAt: c.whatsappOptOutAt,
    smsOptOutAt: smsOut && !Number.isNaN(smsOut.getTime()) ? smsOut : null,
  };
}

/** Abmeldung setzen (STOP) bzw. aufheben (START). Einwilligung für Werbung wird bei Abmeldung entfernt. */
export async function setOptOut(workspaceId: string, contactId: string, kind: ChannelKind, optOut: boolean, source: string) {
  const c = await db.contact.findFirst({ where: { id: contactId, workspaceId }, select: { attributes: true } });
  if (!c) return;
  if (kind === "whatsapp") {
    await db.contact.update({
      where: { id: contactId },
      data: optOut ? { whatsappOptOutAt: new Date(), whatsappConsentAt: null } : { whatsappOptOutAt: null },
    });
  } else {
    const attrs = { ...((c.attributes as Record<string, unknown>) ?? {}) };
    if (optOut) attrs[SMS_OPT_OUT_ATTR] = new Date().toISOString();
    else delete attrs[SMS_OPT_OUT_ATTR];
    await db.contact.update({
      where: { id: contactId },
      data: { attributes: attrs as Prisma.InputJsonValue, ...(optOut ? { smsConsentAt: null } : {}) },
    });
  }
  await db.activity.create({
    data: {
      workspaceId,
      contactId,
      type: "SYSTEM",
      body: `${kind === "whatsapp" ? "WhatsApp" : "SMS"}: ${optOut ? "abgemeldet" : "Abmeldung aufgehoben"} (${source})`,
      meta: { channel: kind, optOut, source },
    },
  });
}

/** Einwilligung (Werbung) manuell erfassen bzw. widerrufen – mit Herkunftsangabe als Nachweis. */
export async function setConsent(workspaceId: string, contactId: string, kind: ChannelKind, granted: boolean, source: string, actor: string) {
  const exists = await db.contact.count({ where: { id: contactId, workspaceId } });
  if (!exists) throw new Error("Kontakt nicht gefunden.");
  const field = kind === "whatsapp" ? "whatsappConsentAt" : "smsConsentAt";
  await db.contact.update({ where: { id: contactId }, data: { [field]: granted ? new Date() : null } });
  await db.activity.create({
    data: {
      workspaceId,
      contactId,
      type: "SYSTEM",
      body: `${kind === "whatsapp" ? "WhatsApp" : "SMS"}-Einwilligung ${granted ? "erfasst" : "widerrufen"}: ${source}`.slice(0, 500),
      meta: { channel: kind, consent: granted, source, actor },
    },
  });
}
