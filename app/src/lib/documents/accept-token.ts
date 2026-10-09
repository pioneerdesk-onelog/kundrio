import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";

// Signierter, öffentlicher Link zur Online-Annahme eines Angebots: <invoiceId>.<ablauf>.<signatur>
// Kein Datenbankeintrag nötig; Gültigkeit = Ablaufzeitpunkt im Token (Standard: Gültig-bis des Angebots, max. 90 Tage).

const MAX_DAYS = 90;

function sign(invoiceId: string, exp: number) {
  return createHmac("sha256", env.appSecret()).update(`doc-accept:${invoiceId}:${exp}`).digest("base64url");
}

export function acceptToken(invoiceId: string, validUntil: Date | null, now = Date.now()): string {
  const cap = now + MAX_DAYS * 864e5;
  const target = validUntil ? validUntil.getTime() + 864e5 - 1 : now + 30 * 864e5; // bis Tagesende
  const exp = Math.min(Math.max(target, now + 864e5), cap);
  return `${invoiceId}.${exp}.${sign(invoiceId, exp)}`;
}

/** Liefert die Beleg-ID, wenn der Token gültig und nicht abgelaufen ist, sonst null. */
export function verifyAcceptToken(token: string, now = Date.now()): { invoiceId: string; exp: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [invoiceId, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!/^[a-z0-9]{10,40}$/i.test(invoiceId) || !Number.isSafeInteger(exp) || exp < now) return null;
  const expected = Buffer.from(sign(invoiceId, exp));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { invoiceId, exp };
}

export function acceptUrl(invoiceId: string, validUntil: Date | null): string {
  return `${env.appUrl()}/dokument/${acceptToken(invoiceId, validUntil)}`;
}
