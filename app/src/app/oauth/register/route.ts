import { headers } from "next/headers";
import { registerClient } from "@/lib/oauth/clients";
import { oauthErrorResponse, oauthJson, preflight } from "@/lib/oauth/http";
import { clientIp } from "@/lib/client-ip";
import { rateLimitAsync } from "@/lib/ratelimit";

// RFC 7591 Dynamic Client Registration (laut MCP 2026-07-28 veraltet, für ältere Clients weiter angeboten)
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ip = clientIp(await headers());
    if (!(await rateLimitAsync(`oauth-register:${ip}`, 20, 60 * 60_000))) {
      return oauthJson({ error: "slow_down", error_description: "Zu viele Registrierungen" }, 429);
    }
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 16 * 1024) return oauthJson({ error: "invalid_client_metadata", error_description: "Anfrage zu groß" }, 400);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return oauthJson({ error: "invalid_client_metadata", error_description: "Ungültiges JSON" }, 400);
    }
    return oauthJson(await registerClient(body), 201);
  } catch (e) {
    return oauthErrorResponse(e);
  }
}

export const OPTIONS = preflight;
