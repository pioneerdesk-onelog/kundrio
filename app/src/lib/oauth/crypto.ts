import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Zufälliges, opakes Token (nur der Hash wird gespeichert). */
export function randomToken(prefix: string, bytes = 32) {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export function isValidChallenge(c: string | null | undefined): c is string {
  return !!c && CHALLENGE.test(c);
}

/** PKCE S256 (RFC 7636): BASE64URL(SHA256(verifier)) === challenge, zeitkonstanter Vergleich. */
export function verifyPkce(verifier: string | null | undefined, challenge: string): boolean {
  if (!verifier || !VERIFIER.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
