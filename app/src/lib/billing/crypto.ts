import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env";

// IBAN der Zahler verschlüsselt (AES-256-GCM, eigener abgeleiteter Schlüssel); Anzeige nur letzte 4 Stellen.
const key = () => createHash("sha256").update(`${env.appSecret()}|sepa-iban`).digest();

export function encryptIban(iban: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(iban, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), enc].map((b) => (typeof b === "string" ? b : b.toString("base64url"))).join(".");
}

export function decryptIban(sealed: string): string {
  const [v, iv, tag, enc] = sealed.split(".");
  if (v !== "v1") throw new Error("Unbekanntes IBAN-Format.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

// ---------- Kundenportal: signierter Link je Kontakt (ohne Ablauf, widerrufbar über Version) ----------
const portalKey = () => createHash("sha256").update(`${env.appSecret()}|kundenportal`).digest();

export function portalToken(contactId: string, version = 1): string {
  const payload = Buffer.from(JSON.stringify({ c: contactId, v: version })).toString("base64url");
  const sig = createHmac("sha256", portalKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPortalToken(token: string): { contactId: string; version: number } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", portalKey()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { c?: unknown; v?: unknown };
    return typeof o.c === "string" && typeof o.v === "number" ? { contactId: o.c, version: o.v } : null;
  } catch {
    return null;
  }
}
