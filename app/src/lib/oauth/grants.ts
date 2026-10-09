import "server-only";
import type { OAuthClient } from "@prisma/client";
import { db } from "../db";
import { getAccess } from "../permissions";
import { ACCESS_TTL_MS, CODE_TTL_MS, REFRESH_TTL_MS, mcpResource, normalizeScopes, sameResource } from "./config";
import { isValidChallenge, randomToken, sha256, verifyPkce } from "./crypto";
import { OAuthError } from "./clients";
import { matchRedirect } from "./redirect";

// Autorisierungscodes, Token-Ausgabe, Refresh-Rotation mit Wiederverwendungs-Erkennung, Widerruf, Prüfung.

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

/** Nach Zustimmung des Benutzers: einmaligen Code (60 s) ausstellen. */
export async function createAuthorizationCode(input: {
  client: OAuthClient;
  userId: string;
  workspaceId: string;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
}) {
  if (!matchRedirect(input.client.redirectUris, input.redirectUri)) throw new OAuthError("invalid_request", "redirect_uri ist für diesen Client nicht registriert");
  if (!isValidChallenge(input.codeChallenge)) throw new OAuthError("invalid_request", "code_challenge fehlt oder ist ungültig (S256)");
  if (input.resource && !sameResource(input.resource, mcpResource())) throw new OAuthError("invalid_target", "Unbekannte Ressource");
  const scopes = normalizeScopes(input.scopes.join(" "));
  if (scopes.length === 0) throw new OAuthError("invalid_scope", "Kein gültiger Umfang");
  const access = await getAccess(input.userId, input.workspaceId);
  if (!access) throw new OAuthError("access_denied", "Kein Zugriff auf diesen Sub-Account");
  const code = randomToken("pdac", 32);
  await db.oAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: input.client.id,
      userId: input.userId,
      workspaceId: input.workspaceId,
      scopes,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource ?? mcpResource(),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return code;
}

async function issue(client: OAuthClient, base: { userId: string; workspaceId: string; scopes: string[]; resource: string | null; familyId: string }): Promise<TokenResponse> {
  const access = randomToken("pdat", 32);
  const refresh = randomToken("pdrt", 32);
  await db.oAuthToken.create({
    data: {
      accessHash: sha256(access),
      refreshHash: sha256(refresh),
      clientId: client.id,
      userId: base.userId,
      workspaceId: base.workspaceId,
      scopes: base.scopes,
      resource: base.resource,
      familyId: base.familyId,
      expiresAt: new Date(Date.now() + ACCESS_TTL_MS),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refresh, scope: base.scopes.join(" ") };
}

export async function revokeFamily(familyId: string) {
  await db.oAuthToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** grant_type=authorization_code (PKCE S256 Pflicht, Code einmalig, redirect_uri und resource müssen passen). */
export async function exchangeCode(client: OAuthClient, form: URLSearchParams): Promise<TokenResponse> {
  const code = form.get("code");
  if (!code) throw new OAuthError("invalid_request", "code fehlt");
  const row = await db.oAuthCode.findUnique({ where: { codeHash: sha256(code) } });
  if (!row || row.clientId !== client.id) throw new OAuthError("invalid_grant", "Code ist ungültig");
  // Einmal-Verwendung atomar beanspruchen; zweite Einlösung → alle daraus entstandenen Tokens widerrufen (OAuth 2.1 Abs. 4.1.3)
  const claimed = await db.oAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count === 0) {
    await revokeFamily(row.id);
    throw new OAuthError("invalid_grant", "Code wurde bereits verwendet");
  }
  if (row.expiresAt < new Date()) throw new OAuthError("invalid_grant", "Code ist abgelaufen");
  if (form.get("redirect_uri") !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri stimmt nicht überein");
  if (!verifyPkce(form.get("code_verifier"), row.codeChallenge)) throw new OAuthError("invalid_grant", "PKCE-Prüfung fehlgeschlagen");
  const resource = form.get("resource");
  if (resource && !sameResource(resource, row.resource ?? mcpResource())) throw new OAuthError("invalid_target", "resource weicht von der Autorisierung ab");
  if (!(await getAccess(row.userId, row.workspaceId))) throw new OAuthError("invalid_grant", "Zugriff besteht nicht mehr");
  return issue(client, { userId: row.userId, workspaceId: row.workspaceId, scopes: row.scopes, resource: row.resource, familyId: row.id });
}

/** grant_type=refresh_token mit Rotation; Wiederverwendung eines abgelösten Tokens widerruft die Familie. */
export async function refreshTokens(client: OAuthClient, form: URLSearchParams): Promise<TokenResponse> {
  const token = form.get("refresh_token");
  if (!token) throw new OAuthError("invalid_request", "refresh_token fehlt");
  const row = await db.oAuthToken.findUnique({ where: { refreshHash: sha256(token) } });
  if (!row || row.clientId !== client.id) throw new OAuthError("invalid_grant", "Refresh-Token ist ungültig");
  if (row.rotatedAt || row.revokedAt) {
    if (row.rotatedAt && row.familyId) await revokeFamily(row.familyId);
    throw new OAuthError("invalid_grant", "Refresh-Token ist nicht mehr gültig");
  }
  if (!row.refreshExpiresAt || row.refreshExpiresAt < new Date()) throw new OAuthError("invalid_grant", "Refresh-Token ist abgelaufen");
  const resource = form.get("resource");
  if (resource && !sameResource(resource, row.resource ?? mcpResource())) throw new OAuthError("invalid_target", "resource weicht ab");
  // Optional engerer Umfang, nie weiter
  const requested = form.get("scope");
  const scopes = requested ? normalizeScopes(requested).filter((s) => row.scopes.includes(s)) : row.scopes;
  if (scopes.length === 0) throw new OAuthError("invalid_scope", "Umfang ist nicht erlaubt");
  if (!(await getAccess(row.userId, row.workspaceId))) {
    if (row.familyId) await revokeFamily(row.familyId);
    throw new OAuthError("invalid_grant", "Zugriff besteht nicht mehr");
  }
  // Rotation atomar: nur wer das Token zuerst ablöst, bekommt neue Tokens
  const rotated = await db.oAuthToken.updateMany({ where: { id: row.id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: new Date(), revokedAt: new Date() } });
  if (rotated.count === 0) {
    if (row.familyId) await revokeFamily(row.familyId);
    throw new OAuthError("invalid_grant", "Refresh-Token ist nicht mehr gültig");
  }
  return issue(client, { userId: row.userId, workspaceId: row.workspaceId, scopes, resource: row.resource, familyId: row.familyId ?? row.id });
}

/** RFC 7009: Widerruf (Access- oder Refresh-Token). Widerruft die ganze Familie. Unbekannte Tokens: still OK. */
export async function revokeToken(client: OAuthClient, token: string | null) {
  if (!token) return;
  const h = sha256(token);
  const row = await db.oAuthToken.findFirst({ where: { OR: [{ accessHash: h }, { refreshHash: h }] } });
  if (!row || row.clientId !== client.id) return;
  if (row.familyId) await revokeFamily(row.familyId);
  else await db.oAuthToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
}

export type VerifiedToken = { tokenId: string; userId: string; workspaceId: string; scopes: string[]; clientId: string };

/** Ressourcen-Seite: Bearer-Token prüfen (Ablauf, Widerruf, Zielgruppe, Benutzer aktiv, Zugriff vorhanden). */
export async function verifyAccessToken(token: string): Promise<VerifiedToken | null> {
  if (!token.startsWith("pdat_") || token.length > 200) return null;
  const row = await db.oAuthToken.findUnique({ where: { accessHash: sha256(token) } });
  if (!row || row.revokedAt || row.expiresAt < new Date()) return null;
  if (!sameResource(row.resource ?? mcpResource(), mcpResource())) return null;
  if (!(await getAccess(row.userId, row.workspaceId))) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.oAuthToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { tokenId: row.id, userId: row.userId, workspaceId: row.workspaceId, scopes: row.scopes, clientId: row.clientId };
}
