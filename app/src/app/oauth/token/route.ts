import { headers } from "next/headers";
import { authenticateClient, OAuthError } from "@/lib/oauth/clients";
import { exchangeCode, refreshTokens } from "@/lib/oauth/grants";
import { oauthErrorResponse, oauthJson, preflight, readForm } from "@/lib/oauth/http";
import { clientIp } from "@/lib/client-ip";
import { rateLimitAsync } from "@/lib/ratelimit";

// Token-Endpunkt: authorization_code (PKCE S256) und refresh_token (Rotation)
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ip = clientIp(await headers());
    if (!(await rateLimitAsync(`oauth-token:${ip}`, 60, 60_000))) return oauthJson({ error: "slow_down", error_description: "Zu viele Anfragen" }, 429);
    const form = await readForm(req);
    const client = await authenticateClient(req.headers, form);
    const grant = form.get("grant_type");
    if (grant === "authorization_code") return oauthJson(await exchangeCode(client, form));
    if (grant === "refresh_token") return oauthJson(await refreshTokens(client, form));
    throw new OAuthError("unsupported_grant_type", "Nur authorization_code und refresh_token");
  } catch (e) {
    return oauthErrorResponse(e);
  }
}

export const OPTIONS = preflight;
