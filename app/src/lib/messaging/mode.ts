import { randomBytes } from "node:crypto";
import { toE164 } from "./phone";

// Testmodus wie bei E-Mail: MESSAGING_MODE=capture (Standard) sendet NICHTS an Anbieter, sondern protokolliert.
// MESSAGING_MODE=live mit MESSAGING_LIVE_ALLOWLIST → nur diese Nummern live, Rest „captured“.

export type MessagingMode = "live" | "capture";

export function messagingMode(env: Record<string, string | undefined> = process.env): MessagingMode {
  return env.MESSAGING_MODE === "live" ? "live" : "capture";
}

/** Freigabeliste: kommagetrennte Rufnummern (beliebiges Format, wird nach E.164 normalisiert). Leer → null. */
export function parseNumberAllowlist(raw: string | undefined | null): string[] | null {
  const items = (raw ?? "")
    .split(/[,;\n]+/)
    .map((s) => toE164(s))
    .filter((s): s is string => Boolean(s));
  return items.length ? Array.from(new Set(items)) : null;
}

/** Wird an diese Nummer wirklich gesendet? */
export function routeNumber(e164: string, env: Record<string, string | undefined> = process.env): "live" | "captured" {
  if (messagingMode(env) !== "live") return "captured";
  const list = parseNumberAllowlist(env.MESSAGING_LIVE_ALLOWLIST);
  if (!list) return "live";
  return list.includes(e164) ? "live" : "captured";
}

/** Kennung für im Testmodus nicht gesendete Nachrichten (Status „captured“ im Posteingang). */
export const CAPTURED_PREFIX = "captured:";

export function captureResult(): { externalId: string; status: "queued" } {
  return { externalId: `${CAPTURED_PREFIX}${randomBytes(8).toString("hex")}`, status: "queued" };
}

export function isCaptured(externalId: string | null | undefined): boolean {
  return Boolean(externalId?.startsWith(CAPTURED_PREFIX));
}
