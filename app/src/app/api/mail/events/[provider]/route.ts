import { applyRelayEvent, parseBrevoEvent } from "@/lib/mail-events";
import { safeEqual } from "@/lib/webhook-sign";
import { rateLimitAsync } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Eingang für Versand-Ereignisse des Relays: POST /api/mail/events/brevo?secret=…
// (oder Header X-PD-Events-Secret). Geheimnis in MAIL_EVENTS_SECRET.
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const secret = process.env.MAIL_EVENTS_SECRET;
  if (!secret || secret.length < 16) return Response.json({ error: "Ereignis-Eingang nicht konfiguriert" }, { status: 503 });
  const given = req.headers.get("x-pd-events-secret") ?? new URL(req.url).searchParams.get("secret") ?? "";
  if (!safeEqual(given, secret)) return Response.json({ error: "forbidden" }, { status: 401 });
  if (!await rateLimitAsync("mail-events", 3000, 60_000)) return Response.json({ error: "too many requests" }, { status: 429 });

  const { provider } = await params;
  if (provider !== "brevo") return Response.json({ error: "unbekannter Anbieter" }, { status: 404 });

  const text = await req.text();
  if (text.length > 1_000_000) return Response.json({ error: "zu groß" }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const items = (Array.isArray(raw) ? raw : [raw]).slice(0, 500);
  let applied = 0;
  let ignored = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") {
      ignored++;
      continue;
    }
    const e = parseBrevoEvent(item as Record<string, unknown>);
    if (e && (await applyRelayEvent(e))) applied++;
    else ignored++;
  }
  // Immer 200 bei gültigem Geheimnis, damit das Relay nicht endlos wiederholt
  return Response.json({ applied, ignored });
}
