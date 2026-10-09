import { env } from "../env";

// OAuth 2.1 Autorisierungsserver für den Admin-MCP (MCP-Spezifikation 2026-07-28, Abschnitt Authorization).
// Ausstellender Server (issuer) und geschützte Ressource liegen in derselben App.

export const SCOPE_READ = "mcp:read";
export const SCOPE_WRITE = "mcp:write";
export const SCOPES_SUPPORTED = [SCOPE_READ, SCOPE_WRITE] as const;

export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

/** Issuer ohne abschließenden Schrägstrich (RFC 8414: exakt so in den Metadaten). */
export function issuer(): string {
  return env.appUrl().replace(/\/+$/, "");
}

/** Kanonische URI der geschützten Ressource (RFC 8707/9728). */
export function mcpResource(): string {
  return `${issuer()}/api/mcp`;
}

export function resourceMetadataUrl(): string {
  return `${issuer()}/.well-known/oauth-protected-resource/api/mcp`;
}

/** Ressourcen-Vergleich: Schema/Host case-insensitiv, abschließender Schrägstrich egal. */
export function sameResource(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    const norm = (u: URL) => `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    return !x.hash && norm(x) === norm(y);
  } catch {
    return false;
  }
}

/** Angefragte Scopes normalisieren: nur bekannte, write impliziert read. */
export function normalizeScopes(raw: string | null | undefined): string[] {
  const req = new Set((raw ?? "").split(/\s+/).filter(Boolean));
  const out = new Set<string>();
  if (req.has(SCOPE_WRITE)) out.add(SCOPE_WRITE).add(SCOPE_READ);
  if (req.has(SCOPE_READ)) out.add(SCOPE_READ);
  return [...out];
}

export function hasScope(scopes: string[], needed: string) {
  if (needed === SCOPE_READ) return scopes.includes(SCOPE_READ) || scopes.includes(SCOPE_WRITE);
  return scopes.includes(needed);
}
