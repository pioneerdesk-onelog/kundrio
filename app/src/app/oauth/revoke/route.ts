import { authenticateClient } from "@/lib/oauth/clients";
import { revokeToken } from "@/lib/oauth/grants";
import { oauthErrorResponse, preflight, readForm } from "@/lib/oauth/http";

// RFC 7009: Widerruf. Antwortet bei unbekannten Tokens ebenfalls mit 200.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await readForm(req);
    const client = await authenticateClient(req.headers, form);
    await revokeToken(client, form.get("token"));
    return new Response(null, { status: 200, headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });
  } catch (e) {
    return oauthErrorResponse(e);
  }
}

export const OPTIONS = preflight;
