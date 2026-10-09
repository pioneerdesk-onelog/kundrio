import "server-only";
import type { OAuthClient } from "@prisma/client";
import { OAuthError, resolveClient } from "./clients";
import { SCOPE_READ, SCOPE_WRITE, issuer, mcpResource, normalizeScopes, sameResource } from "./config";
import { isValidChallenge } from "./crypto";
import { isLoopback, matchRedirect } from "./redirect";

// Prüfung der Autorisierungsanfrage (GET der Zustimmungsseite und erneut in der Server Action).

export type AuthorizeParams = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
  resource?: string;
};

export type AuthorizeCheck =
  | { kind: "fatal"; message: string } // niemals umleiten (Client/Redirect unbekannt)
  | { kind: "redirect_error"; url: string }
  | {
      kind: "ok";
      client: OAuthClient;
      redirectUri: string;
      state: string | null;
      codeChallenge: string;
      requestedScopes: string[];
      resource: string | null;
      localhostOnly: boolean;
    };

/** Baut die Rücksprung-URL zum Client (mit iss nach RFC 9207). */
export function buildRedirect(redirectUri: string, params: Record<string, string | null | undefined>) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set("iss", issuer());
  return u.toString();
}

export async function checkAuthorizeRequest(p: AuthorizeParams): Promise<AuthorizeCheck> {
  let client: OAuthClient;
  try {
    client = await resolveClient(p.client_id);
  } catch (e) {
    return { kind: "fatal", message: e instanceof OAuthError ? e.message : "Client konnte nicht geprüft werden" };
  }
  const redirectUri = p.redirect_uri ?? "";
  if (!redirectUri || !matchRedirect(client.redirectUris, redirectUri)) {
    return { kind: "fatal", message: "Die Rücksprung-Adresse (redirect_uri) ist für diese Anwendung nicht registriert." };
  }
  const state = p.state ? p.state.slice(0, 500) : null;
  const err = (error: string, description: string) => ({ kind: "redirect_error" as const, url: buildRedirect(redirectUri, { error, error_description: description, state }) });

  if (p.response_type !== "code") return err("unsupported_response_type", "Nur response_type=code");
  if (p.code_challenge_method !== "S256" || !isValidChallenge(p.code_challenge)) return err("invalid_request", "PKCE mit code_challenge_method=S256 ist Pflicht");
  if (p.resource && !sameResource(p.resource, mcpResource())) return err("invalid_target", "Unbekannte Ressource");

  // Ohne scope: beide Umfänge anfragen (scopes_supported); der Benutzer entscheidet auf der Zustimmungsseite
  const requestedScopes = p.scope === undefined ? [SCOPE_READ, SCOPE_WRITE] : normalizeScopes(p.scope);
  if (requestedScopes.length === 0) return err("invalid_scope", "Unterstützt: mcp:read, mcp:write");

  const localhostOnly = client.redirectUris.every((u) => isLoopback(u));
  return {
    kind: "ok",
    client,
    redirectUri,
    state,
    codeChallenge: p.code_challenge!,
    requestedScopes,
    resource: p.resource ?? null,
    localhostOnly,
  };
}
