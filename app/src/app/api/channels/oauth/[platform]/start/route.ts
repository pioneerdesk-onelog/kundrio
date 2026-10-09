import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { routeGuard } from "@/lib/permissions/guard";
import { platformInfo, redirectUri } from "@/lib/channels/config";
import { challengeFor, createState } from "@/lib/channels/crypto";
import { connectorFor } from "@/lib/channels/registry";
import { PLATFORMS, type Platform } from "@/lib/channels/types";

// Startet die Verbindung eines Kanals (OAuth). Nur mit Recht „Zugänge verwalten“; state ist verschlüsselt und an
// Benutzer, Sub-Account, Kanal und PKCE-Verifier gebunden.
export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") ?? "";
  const accountId = url.searchParams.get("account") ?? "";
  if (!(PLATFORMS as readonly string[]).includes(platform)) return new Response("Unbekannte Plattform", { status: 404 });

  const g = await routeGuard(slug, { special: "manage_keys" });
  if (g instanceof Response) return g;
  const back = (q: string) => NextResponse.redirect(new URL(`/sa/${slug}/kanaele?${q}`, env.appUrl()));

  const acc = await db.channelAccount.findFirst({ where: { id: accountId, workspaceId: g.ws.id, platform } });
  if (!acc) return back(`fehler=${encodeURIComponent("Kanal nicht gefunden.")}`);

  const info = platformInfo(platform as Platform);
  const connector = connectorFor(platform);
  if (info.mode !== "oauth" || !connector?.authorizeUrl) return back(`fehler=${encodeURIComponent("Diese Plattform wird ohne Anmeldung angebunden.")}`);
  if (!info.configured) return back(`fehler=${encodeURIComponent(`Schnittstelle nicht eingerichtet: ${info.envVars.join(", ")}`)}`);

  const { state, verifier } = createState({ p: platform as Platform, ws: g.ws.id, u: g.user.id, a: acc.id, slug });
  return NextResponse.redirect(connector.authorizeUrl({ redirectUri: redirectUri(env.appUrl(), platform as Platform), state, challenge: challengeFor(verifier) }));
}
