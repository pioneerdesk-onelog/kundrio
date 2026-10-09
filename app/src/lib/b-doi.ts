import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// Double-Opt-in: signierter Link je Kontakt + Formular, 7 Tage gültig.
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function sign(contactId: string, formId: string, ts: number) {
  return createHmac("sha256", env.appSecret()).update(`doi:${contactId}:${formId}:${ts}`).digest("base64url");
}

export function doiToken(contactId: string, formId: string, now = Date.now()): string {
  return `${formId}.${now}.${sign(contactId, formId, now)}`;
}

/** Liefert die Formular-ID, wenn der Token gültig und nicht abgelaufen ist, sonst null. */
export function verifyDoiToken(contactId: string, token: string, now = Date.now()): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [formId, tsRaw, sig] = parts;
  const ts = Number(tsRaw);
  if (!formId || !Number.isSafeInteger(ts) || now - ts > MAX_AGE_MS || ts > now + 60_000) return null;
  const expected = Buffer.from(sign(contactId, formId, ts));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? formId : null;
}

export function doiUrl(contactId: string, formId: string): string {
  return `${env.appUrl()}/c/${contactId}/${doiToken(contactId, formId)}`;
}
