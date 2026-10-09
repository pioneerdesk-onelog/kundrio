import "server-only";
import { randomBytes } from "node:crypto";
import type { OAuthClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { safeFetchText } from "../c-fetch";
import { redirectUriProblem } from "./redirect";
import { safeEqual, sha256 } from "./crypto";

// Client-Registrierung: Client ID Metadata Documents (empfohlen, MCP 2026-07-28) und
// Dynamic Client Registration RFC 7591 (laut Spezifikation veraltet, aber für ältere Clients unterstützt).

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const AUTH_METHODS = ["none", "client_secret_basic", "client_secret_post"] as const;

const registrationSchema = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().trim().max(100).optional(),
  client_uri: z.string().max(500).optional(),
  logo_uri: z.string().max(500).optional(),
  token_endpoint_auth_method: z.enum(AUTH_METHODS).optional(),
  grant_types: z.array(z.string().max(60)).max(5).optional(),
  response_types: z.array(z.string().max(20)).max(3).optional(),
  scope: z.string().max(200).optional(),
  application_type: z.enum(["web", "native"]).optional(),
  software_id: z.string().max(200).optional(),
  software_version: z.string().max(60).optional(),
});

function checkMetadata(meta: z.infer<typeof registrationSchema>) {
  for (const uri of meta.redirect_uris) {
    const p = redirectUriProblem(uri);
    if (p) throw new OAuthError("invalid_redirect_uri", `${p}: ${uri}`);
  }
  const grants = meta.grant_types ?? ["authorization_code", "refresh_token"];
  if (grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    throw new OAuthError("invalid_client_metadata", "Nur grant_types authorization_code und refresh_token werden unterstützt");
  }
  if ((meta.response_types ?? ["code"]).some((r) => r !== "code")) {
    throw new OAuthError("invalid_client_metadata", "Nur response_type code wird unterstützt");
  }
  return grants;
}

/** Name nur als reiner Text (keine Steuerzeichen), damit die Zustimmungsseite nicht manipuliert werden kann. */
function cleanName(name: string | undefined, fallback: string) {
  const n = (name ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim();
  return (n || fallback).slice(0, 100);
}

/** RFC 7591: dynamische Registrierung. Gibt die Registrierungsantwort zurück. */
export async function registerClient(body: unknown) {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    throw new OAuthError("invalid_client_metadata", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const meta = parsed.data;
  const grants = checkMetadata(meta);
  const method = meta.token_endpoint_auth_method ?? "none";
  const clientId = `pdc_${randomBytes(16).toString("base64url")}`;
  const secret = method === "none" ? null : `pdcs_${randomBytes(32).toString("base64url")}`;
  const client = await db.oAuthClient.create({
    data: {
      clientId,
      secretHash: secret ? sha256(secret) : null,
      name: cleanName(meta.client_name, "Unbenannter MCP-Client"),
      redirectUris: meta.redirect_uris,
      registeredBy: "dynamic",
      metadata: { token_endpoint_auth_method: method, grant_types: grants, client_uri: meta.client_uri ?? null, application_type: meta.application_type ?? null, software_id: meta.software_id ?? null } as Prisma.InputJsonValue,
    },
  });
  return {
    client_id: client.clientId,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: grants,
    response_types: ["code"],
    token_endpoint_auth_method: method,
  };
}

/** Ist die client_id eine CIMD-URL (https mit Pfad)? */
export function isCimdClientId(clientId: string) {
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" && u.pathname.length > 1 && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

const CIMD_TTL_MS = 60 * 60_000;

/** Client ID Metadata Document abrufen (SSRF-geschützt, ohne Weiterleitungen) und zwischenspeichern. */
async function loadCimd(clientId: string): Promise<OAuthClient> {
  const cached = await db.oAuthClient.findUnique({ where: { clientId } });
  const fetchedAt = Number((cached?.metadata as { fetchedAt?: number } | null)?.fetchedAt ?? 0);
  if (cached && Date.now() - fetchedAt < CIMD_TTL_MS) return cached;

  let doc: unknown;
  try {
    const res = await safeFetchText(clientId);
    if (res.url !== new URL(clientId).toString()) throw new Error("Weiterleitungen sind nicht erlaubt");
    doc = JSON.parse(res.text);
  } catch (e) {
    if (cached) return cached; // vorübergehender Fehler: letzte gültige Fassung weiterverwenden
    throw new OAuthError("invalid_client", `Client-Metadaten konnten nicht geladen werden: ${e instanceof Error ? e.message : e}`, 401);
  }
  const parsed = registrationSchema.extend({ client_id: z.string() }).safeParse(doc);
  if (!parsed.success) throw new OAuthError("invalid_client", "Client-Metadaten sind ungültig", 401);
  if (parsed.data.client_id !== clientId) throw new OAuthError("invalid_client", "client_id im Dokument stimmt nicht mit der URL überein", 401);
  const grants = checkMetadata(parsed.data);
  const method = parsed.data.token_endpoint_auth_method ?? "none";
  if (method !== "none") throw new OAuthError("invalid_client", "Für Metadaten-Clients wird nur token_endpoint_auth_method none unterstützt", 401);
  const data = {
    name: cleanName(parsed.data.client_name, new URL(clientId).host),
    redirectUris: parsed.data.redirect_uris,
    registeredBy: "cimd",
    metadata: { token_endpoint_auth_method: "none", grant_types: grants, client_uri: parsed.data.client_uri ?? null, fetchedAt: Date.now() } as Prisma.InputJsonValue,
  };
  return db.oAuthClient.upsert({ where: { clientId }, create: { clientId, ...data }, update: data });
}

/** Client für Autorisierung bzw. Token-Anfrage auflösen. */
export async function resolveClient(clientId: string | null | undefined): Promise<OAuthClient> {
  if (!clientId || clientId.length > 500) throw new OAuthError("invalid_client", "client_id fehlt oder ist ungültig", 401);
  if (isCimdClientId(clientId)) return loadCimd(clientId);
  const c = await db.oAuthClient.findUnique({ where: { clientId } });
  if (!c) throw new OAuthError("invalid_client", "Unbekannter Client", 401);
  return c;
}

export function authMethod(client: OAuthClient): (typeof AUTH_METHODS)[number] {
  const m = (client.metadata as { token_endpoint_auth_method?: string } | null)?.token_endpoint_auth_method;
  return (AUTH_METHODS as readonly string[]).includes(m ?? "") ? (m as (typeof AUTH_METHODS)[number]) : "none";
}

/**
 * Client-Authentifizierung am Token-Endpunkt. Öffentliche Clients: nur client_id (+ PKCE).
 * Vertrauliche Clients: Geheimnis per Basic oder im Formular.
 */
export async function authenticateClient(headers: Headers, form: URLSearchParams): Promise<OAuthClient> {
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  const basic = headers.get("authorization");
  if (basic?.toLowerCase().startsWith("basic ")) {
    try {
      const [u, p] = Buffer.from(basic.slice(6), "base64").toString("utf8").split(":");
      id = decodeURIComponent(u ?? "");
      secret = decodeURIComponent(p ?? "");
    } catch {
      throw new OAuthError("invalid_client", "Ungültige Client-Anmeldung", 401);
    }
  }
  const client = await resolveClient(id);
  if (client.secretHash) {
    if (!secret || !safeEqual(sha256(secret), client.secretHash)) throw new OAuthError("invalid_client", "Client-Anmeldung fehlgeschlagen", 401);
  }
  return client;
}
