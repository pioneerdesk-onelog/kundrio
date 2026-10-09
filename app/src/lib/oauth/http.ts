import "server-only";
import { OAuthError } from "./clients";

// Antworten der OAuth-Endpunkte: kein Caching, CORS ohne Cookies (Clients laufen teils im Browser).

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-max-age": "600",
};

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", pragma: "no-cache", ...CORS, ...extra },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

export function oauthErrorResponse(e: unknown) {
  if (e instanceof OAuthError) {
    const extra: Record<string, string> = e.status === 401 ? { "www-authenticate": 'Basic realm="oauth"' } : {};
    return oauthJson({ error: e.code, error_description: e.message }, e.status, extra);
  }
  console.error("OAuth-Fehler", e instanceof Error ? e.message : e);
  return oauthJson({ error: "server_error", error_description: "Interner Fehler" }, 500);
}

/** Formular-Body (application/x-www-form-urlencoded) mit Größenlimit lesen. */
export async function readForm(req: Request, maxBytes = 16 * 1024): Promise<URLSearchParams> {
  const raw = await req.text();
  if (Buffer.byteLength(raw) > maxBytes) throw new OAuthError("invalid_request", "Anfrage zu groß");
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded")) throw new OAuthError("invalid_request", "Content-Type muss application/x-www-form-urlencoded sein");
  return new URLSearchParams(raw);
}
