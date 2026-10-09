import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PROVIDERS, type Provider } from "@/lib/calendar/config";
import { exchangeCode, readState } from "@/lib/calendar/oauth";
import { accountEmailFromTokens, saveConnection } from "@/lib/calendar/connections";

// Rücksprung von Google/Microsoft: state prüfen (Benutzer, Anbieter, Alter), Code gegen Tokens tauschen.
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!PROVIDERS.includes(provider as Provider)) return new Response("Unbekannter Anbieter", { status: 404 });
  const p = provider as Provider;
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/konto/kalender");
  const url = new URL(req.url);
  const fail = (msg: string, back = "/konto/kalender") => redirect(`${back}${back.includes("?") ? "&" : "?"}fehler=${encodeURIComponent(msg)}`);

  const err = url.searchParams.get("error");
  if (err) fail(err === "access_denied" ? "Verbindung abgebrochen." : `Anbieter meldet: ${err.slice(0, 80)}`);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code || !stateRaw) fail("Antwort des Anbieters unvollständig.");

  let back = "/konto/kalender";
  let ok = false;
  let message = "";
  try {
    const state = readState(stateRaw!, user.id, p);
    back = state.r;
    const tokens = await exchangeCode(p, code!, state.v);
    const email = await accountEmailFromTokens(p, tokens);
    await saveConnection(user.id, p, tokens, email);
    ok = true;
    message = `${p === "google" ? "Google" : "Microsoft"}-Kalender ${email} verbunden.`;
  } catch (e) {
    message = e instanceof Error ? e.message : "Verbindung fehlgeschlagen.";
  }
  redirect(`${back}${back.includes("?") ? "&" : "?"}${ok ? "ok" : "fehler"}=${encodeURIComponent(message)}`);
}
