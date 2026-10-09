import "server-only";
import { AgentError } from "./agent-core";
import { errMessage, log } from "@/lib/log";

// CORS: offen für GET/POST ohne Credentials (Agenten und fremde Websites dürfen fragen).
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS_HEADERS, ...extra },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const MAX_BODY = 32 * 1024;

/** Liest JSON mit Größenlimit. Wirft AgentError(400/413) bei Problemen. */
export async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) throw new AgentError(413, "Anfrage zu groß");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new AgentError(413, "Anfrage zu groß");
  try {
    return JSON.parse(text);
  } catch {
    throw new AgentError(400, "Ungültiges JSON");
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof AgentError) return json({ error: err.message }, err.status);
  log.error("agent api error", { error: errMessage(err) });
  return json({ error: "Interner Fehler. Bitte später erneut versuchen." }, 500);
}
