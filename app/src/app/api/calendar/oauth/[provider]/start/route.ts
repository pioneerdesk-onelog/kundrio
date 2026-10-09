import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isConfigured, PROVIDERS, type Provider } from "@/lib/calendar/config";
import { authorizeUrl, makeState, pkcePair } from "@/lib/calendar/oauth";

// Start der Kalender-Verbindung für den angemeldeten Benutzer (Google oder Microsoft).
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!PROVIDERS.includes(provider as Provider)) return new Response("Unbekannter Anbieter", { status: 404 });
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/konto/kalender");
  const p = provider as Provider;
  if (!isConfigured(p)) redirect(`/konto/kalender?fehler=${encodeURIComponent("Anbieter ist noch nicht eingerichtet (Client-ID/Secret fehlen).")}`);
  const back = new URL(req.url).searchParams.get("back") ?? "/konto/kalender";
  const { verifier, challenge } = pkcePair();
  const state = makeState(user.id, p, verifier, back);
  redirect(authorizeUrl(p, state, challenge));
}
