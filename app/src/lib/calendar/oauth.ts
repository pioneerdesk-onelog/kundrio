// OAuth 2.0 (Authorization Code + PKCE) für Google und Microsoft.
// Der state ist verschlüsselt und authentifiziert (AES-GCM) und enthält Benutzer, Anbieter,
// PKCE-Verifier, Zeitstempel und Rücksprungpfad – er ist an den angemeldeten Benutzer gebunden.

import { createHash, randomBytes } from "node:crypto";
import { open, seal } from "../migrate/secretbox";
import { SCOPES, calendarEnv, redirectUri, type Provider } from "./config";

const STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthState = { u: string; p: Provider; v: string; t: number; r: string };

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function makeState(userId: string, provider: Provider, verifier: string, returnTo: string, now = Date.now()): string {
  const r = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/konto/kalender";
  return seal(JSON.stringify({ u: userId, p: provider, v: verifier, t: now, r } satisfies OAuthState));
}

/** Prüft state: entschlüsselbar, passender Benutzer + Anbieter, nicht älter als 10 Minuten. */
export function readState(state: string, userId: string, provider: Provider, now = Date.now()): OAuthState {
  let s: OAuthState;
  try {
    s = JSON.parse(open(state)) as OAuthState;
  } catch {
    throw new Error("Ungültiger oder manipulierter Anmeldestatus (state).");
  }
  if (s.u !== userId) throw new Error("Die Anmeldung gehört zu einem anderen Benutzer.");
  if (s.p !== provider) throw new Error("Anbieter passt nicht zum Anmeldestatus.");
  if (now - s.t > STATE_TTL_MS || s.t > now + 60_000) throw new Error("Anmeldung abgelaufen – bitte erneut verbinden.");
  return s;
}

export function authorizeUrl(provider: Provider, state: string, challenge: string): string {
  if (provider === "google") {
    const q = new URLSearchParams({
      client_id: calendarEnv.googleClientId(),
      redirect_uri: redirectUri("google"),
      response_type: "code",
      scope: SCOPES.google.join(" "),
      access_type: "offline", // Refresh-Token
      prompt: "consent", // Refresh-Token auch bei erneuter Verbindung
      include_granted_scopes: "true",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return `${calendarEnv.googleAuthBase()}/o/oauth2/v2/auth?${q}`;
  }
  const q = new URLSearchParams({
    client_id: calendarEnv.msClientId(),
    redirect_uri: redirectUri("microsoft"),
    response_type: "code",
    response_mode: "query",
    scope: SCOPES.microsoft.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${calendarEnv.msLoginBase()}/${encodeURIComponent(calendarEnv.msTenant())}/oauth2/v2.0/authorize?${q}`;
}

export type TokenSet = { accessToken: string; refreshToken?: string; expiresAt: Date; scope?: string; idToken?: string };

function tokenUrl(provider: Provider) {
  return provider === "google"
    ? calendarEnv.googleTokenUrl()
    : `${calendarEnv.msLoginBase()}/${encodeURIComponent(calendarEnv.msTenant())}/oauth2/v2.0/token`;
}

function clientCreds(provider: Provider) {
  return provider === "google"
    ? { client_id: calendarEnv.googleClientId(), client_secret: calendarEnv.googleClientSecret() }
    : { client_id: calendarEnv.msClientId(), client_secret: calendarEnv.msClientSecret() };
}

export class OAuthError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function tokenRequest(provider: Provider, body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(tokenUrl(provider), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ ...clientCreds(provider), ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    const code = typeof data.error === "string" ? data.error : `http_${res.status}`;
    // keine Token-/Geheimniswerte in Fehlermeldungen
    throw new OAuthError(`Token-Abruf bei ${provider === "google" ? "Google" : "Microsoft"} fehlgeschlagen (${code}).`, code);
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
    scope: typeof data.scope === "string" ? data.scope : undefined,
    idToken: typeof data.id_token === "string" ? data.id_token : undefined,
  };
}

export function exchangeCode(provider: Provider, code: string, verifier: string) {
  return tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider),
    code_verifier: verifier,
    ...(provider === "microsoft" ? { scope: SCOPES.microsoft.join(" ") } : {}),
  });
}

export function refreshTokens(provider: Provider, refreshToken: string) {
  return tokenRequest(provider, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    ...(provider === "microsoft" ? { scope: SCOPES.microsoft.join(" ") } : {}),
  });
}

/** Widerruf (nur Google bietet einen Endpunkt; bei Microsoft genügt das Löschen + Hinweis). */
export async function revokeToken(provider: Provider, token: string) {
  if (provider !== "google") return;
  await fetch(process.env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}
