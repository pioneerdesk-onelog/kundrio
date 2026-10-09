import { clientIp } from "@/lib/client-ip";
import { handleVerification, handleWebhookPost, WEBHOOK_MAX_BYTES } from "@/lib/messaging/webhook";

// Öffentlicher Webhook für WhatsApp (Meta) und SMS (seven.io). Keine Anmeldung – Schutz über Signaturprüfung.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string; inboxId: string }> };

function reply(o: { status: number; body: string; contentType?: string }) {
  return new Response(o.body, { status: o.status, headers: { "content-type": o.contentType ?? "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(req: Request, { params }: Ctx) {
  const { provider, inboxId } = await params;
  return reply(await handleVerification(provider, inboxId, new URL(req.url)));
}

export async function POST(req: Request, { params }: Ctx) {
  const { provider, inboxId } = await params;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > WEBHOOK_MAX_BYTES) return reply({ status: 413, body: "too large" });
  const raw = await req.text();
  return reply(await handleWebhookPost(provider, inboxId, req, raw, clientIp(req.headers)));
}
