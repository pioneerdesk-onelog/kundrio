import { clientIp } from "@/lib/client-ip";
import { handleWebhookRequest, WEBHOOK_MAX_BYTES } from "@/lib/payments/service";

// Öffentlicher Webhook der Zahlungsanbieter (Mollie, Revolut, Unzer). Keine Anmeldung –
// Schutz: Signaturprüfung (Revolut), Zustand wird immer mit eigenem Schlüssel beim Anbieter abgefragt.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string; providerId: string }> };

function reply(status: number, body: string) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(req: Request, { params }: Ctx) {
  const { provider, providerId } = await params;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > WEBHOOK_MAX_BYTES) return reply(413, "too large");
  const raw = await req.text();
  const r = await handleWebhookRequest(provider, providerId, req.headers, raw, clientIp(req.headers));
  return reply(r.status, r.body);
}
