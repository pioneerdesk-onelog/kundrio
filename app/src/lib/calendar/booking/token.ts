// Verwaltungslink für Gäste (Umbuchen/Absagen). Das Token ist zufällig (32 Byte); in der DB liegt nur
// ein HMAC (mit APP_SECRET signiert) – wer die DB liest, kann daraus keinen gültigen Link bauen.

import { createHmac, randomBytes } from "node:crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newManageToken(secret: string): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashManageToken(secret, token) };
}

export function hashManageToken(secret: string, token: string): string {
  return createHmac("sha256", secret).update(`booking-manage:${token}`).digest("hex");
}

export function isWellFormedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

/** Zeitstempel-Kennung für das Ausfüll-Zeitsignal (Lead-Echtheit) je Buchungsseite. */
export const bookingFormKey = (meetingTypeId: string) => `booking:${meetingTypeId}`;

/** Kennung im Double-Opt-in-Token (statt Formular-ID) – Präfix ohne Punkte, da das Token „.“ trennt. */
export const DOI_PREFIX = "bk-";
export const bookingDoiKey = (meetingTypeId: string) => `${DOI_PREFIX}${meetingTypeId}`;
