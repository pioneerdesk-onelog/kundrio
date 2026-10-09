import { acceptTransactional } from "@/lib/mail-transactional";
import { readJson, withApiKey } from "@/lib/mail-api";

export const dynamic = "force-dynamic";

// Brevo-kompatibel: POST /v3/smtp/email → 201 { messageId }
export async function POST(req: Request) {
  return withApiKey(req, "mail:send", async (auth) => {
    const body = await readJson(req, 15_000_000);
    if (!body.ok) return body.res;
    const r = await acceptTransactional(auth, body.data);
    return Response.json(r.body, { status: r.status });
  });
}
