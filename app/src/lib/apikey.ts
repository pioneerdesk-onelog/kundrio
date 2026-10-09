import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { rateLimitAsync } from "./ratelimit";

// API-Schlüssel pro Sub-Account. Format: pdk_<prefix>_<geheim>. Gespeichert wird nur der SHA-256.
// Akzeptiert Brevo-kompatibel den Header `api-key` sowie `Authorization: Bearer …`.

export const SCOPES = ["mail:send", "contacts:read", "contacts:write", "templates:read", "webhooks:manage", "mcp:read", "mcp:write"] as const;
export type Scope = (typeof SCOPES)[number];

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createApiKey(input: { workspaceId: string; name: string; scopes: Scope[]; createdBy?: string }) {
  const prefix = `pdk_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");
  const plain = `${prefix}_${secret}`;
  const key = await db.apiKey.create({
    data: { workspaceId: input.workspaceId, name: input.name, scopes: input.scopes, prefix, hash: sha256(plain), createdBy: input.createdBy },
  });
  // Klartext nur dieses eine Mal zurückgeben
  return { key, plain };
}

export type ApiAuth = { workspaceId: string; keyId: string; scopes: string[] };

export class ApiAuthError extends Error {
  constructor(public status: 401 | 403 | 429, message: string) {
    super(message);
  }
}

/** Prüft den Schlüssel aus dem Request und die nötige Berechtigung. Wirft ApiAuthError. */
export async function authenticateApiKey(req: Request, scope: Scope): Promise<ApiAuth> {
  const header = req.headers.get("api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const token = header.trim();
  if (!token.startsWith("pdk_") || token.length > 200) throw new ApiAuthError(401, "Key not found");
  const key = await db.apiKey.findUnique({ where: { hash: sha256(token) } });
  if (!key || key.revokedAt) throw new ApiAuthError(401, "Key not found");
  if (!key.scopes.includes(scope)) throw new ApiAuthError(403, `Missing permission: ${scope}`);
  if (!await rateLimitAsync(`apikey:${key.id}`, 600, 60_000)) throw new ApiAuthError(429, "Too many requests");
  // lastUsedAt höchstens minütlich schreiben
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { workspaceId: key.workspaceId, keyId: key.id, scopes: key.scopes };
}

/** Fehlerantwort im Brevo-Format: { code, message } */
export function apiError(status: number, code: string, message: string) {
  return Response.json({ code, message }, { status });
}
