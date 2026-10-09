// OAuth-state und Zugangsdaten: verschlüsselt (AES-256-GCM über secretbox) und mit Ablauf.
// Der PKCE-Verifier steckt verschlüsselt im state – für Browser und Anbieter unlesbar.
import { createHash, randomBytes } from "node:crypto";
import { open, seal } from "../migrate/secretbox";
import type { Credentials, Platform } from "./types";

export type OAuthState = {
  p: Platform;
  ws: string; // Workspace-ID
  u: string; // Benutzer-ID (muss beim Callback derselbe sein)
  a: string; // ChannelAccount-ID
  slug: string;
  v: string; // PKCE-Verifier
  n: string; // Nonce
  exp: number; // Ablauf (ms)
};

const STATE_TTL_MS = 10 * 60 * 1000;

export function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createState(input: Omit<OAuthState, "n" | "exp" | "v"> & { v?: string }, now = Date.now()): { state: string; verifier: string } {
  const verifier = input.v ?? pkcePair().verifier;
  const payload: OAuthState = { ...input, v: verifier, n: randomBytes(8).toString("hex"), exp: now + STATE_TTL_MS };
  return { state: seal(JSON.stringify(payload)), verifier };
}

export function challengeFor(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Prüft Integrität (GCM-Tag), Ablauf, Plattform und Benutzer. Wirft bei jeder Abweichung. */
export function verifyState(state: string, expect: { platform: Platform; userId: string }, now = Date.now()): OAuthState {
  let parsed: OAuthState;
  try {
    parsed = JSON.parse(open(state)) as OAuthState;
  } catch {
    throw new Error("Ungültiger oder manipulierter Anmeldestatus.");
  }
  if (parsed.exp < now) throw new Error("Anmeldung abgelaufen – bitte erneut verbinden.");
  if (parsed.p !== expect.platform) throw new Error("Anmeldestatus passt nicht zur Plattform.");
  if (parsed.u !== expect.userId) throw new Error("Anmeldung wurde von einem anderen Benutzer gestartet.");
  return parsed;
}

export function sealCredentials(c: Credentials): string {
  return seal(JSON.stringify(c));
}

export function openCredentials(sealed: string | null | undefined): Credentials | null {
  if (!sealed) return null;
  try {
    return JSON.parse(open(sealed)) as Credentials;
  } catch {
    return null;
  }
}

/** Token aus Fehlertexten entfernen, bevor sie gespeichert/angezeigt werden. */
export function redact(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("***");
  return out.replace(/(access_token|client_secret|refresh_token)=[^&\s"]+/gi, "$1=***");
}
