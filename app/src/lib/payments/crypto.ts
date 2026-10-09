import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env";
import type { Credentials } from "./types";

// Zugangsdaten der Zahlungsanbieter/Bankkonten verschlüsselt (AES-256-GCM, eigener abgeleiteter Schlüssel).
// Öffentliche Bezahl-Links tragen ein HMAC-signiertes Token (Rechnungs-ID), kein Datenbank-Geheimnis.

const credKey = () => createHash("sha256").update(`${env.appSecret()}|payments-credentials`).digest();
const linkKey = () => createHash("sha256").update(`${env.appSecret()}|payments-link`).digest();

export function sealCredentials(c: Credentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(c), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function openCredentials(sealed: string | null | undefined): Credentials {
  if (!sealed) return {};
  try {
    const [v, iv, tag, enc] = sealed.split(".");
    if (v !== "v1") return {};
    const d = createDecipheriv("aes-256-gcm", credKey(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
    const parsed = JSON.parse(plain) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Credentials) : {};
  } catch {
    return {};
  }
}

/** Anzeige ohne Geheimnis: "sk_…a1b2" */
export function maskSecret(v: string | undefined): string {
  if (!v) return "";
  return v.length <= 8 ? "••••" : `${v.slice(0, 5)}…${v.slice(-4)}`;
}

/** Token für die öffentliche Bezahlseite /zahlung/<token> (Rechnung, Version für Widerruf). */
export function payToken(invoiceId: string, version = 1): string {
  const payload = Buffer.from(JSON.stringify({ i: invoiceId, v: version })).toString("base64url");
  const sig = createHmac("sha256", linkKey()).update(payload).digest("base64url").slice(0, 32);
  return `${payload}.${sig}`;
}

export function verifyPayToken(token: string): { invoiceId: string; version: number } | null {
  if (typeof token !== "string" || token.length > 300) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(createHmac("sha256", linkKey()).update(payload).digest("base64url").slice(0, 32));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { i?: unknown; v?: unknown };
    if (typeof p.i !== "string" || !/^[a-z0-9]{10,40}$/.test(p.i)) return null;
    return { invoiceId: p.i, version: typeof p.v === "number" ? p.v : 1 };
  } catch {
    return null;
  }
}

export function safeEqualStr(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
