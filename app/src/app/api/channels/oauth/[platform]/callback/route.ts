import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { routeGuard } from "@/lib/permissions/guard";
import { redirectUri } from "@/lib/channels/config";
import { redact, sealCredentials, verifyState } from "@/lib/channels/crypto";
import { connectorFor } from "@/lib/channels/registry";
import { pickCandidate } from "@/lib/channels/candidates";
import { PLATFORMS, type Platform } from "@/lib/channels/types";

// Rückkehr von der Plattform: state prüfen (Benutzer, Ablauf, Integrität), Code tauschen, Token verschlüsselt speichern,
// passendes Konto (Seite/Organisation) wählen. Nie Tokens in URL oder Log.
export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const url = new URL(req.url);
  const home = (path: string) => NextResponse.redirect(new URL(path, env.appUrl()));
  if (!(PLATFORMS as readonly string[]).includes(platform)) return new Response("Unbekannte Plattform", { status: 404 });

  const user = await getCurrentUser();
  if (!user) return home("/login");

  let st;
  try {
    st = verifyState(url.searchParams.get("state") ?? "", { platform: platform as Platform, userId: user.id });
  } catch (e) {
    return home(`/?fehler=${encodeURIComponent(e instanceof Error ? e.message : "Ungültige Anmeldung")}`);
  }
  const back = (q: string) => home(`/sa/${st.slug}/kanaele?${q}`);
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) return back(`fehler=${encodeURIComponent(`Verbindung abgebrochen: ${providerError.slice(0, 200)}`)}`);

  // Rechte erneut prüfen (könnten inzwischen entzogen sein)
  const g = await routeGuard(st.slug, { special: "manage_keys" });
  if (g instanceof Response) return g;
  if (g.ws.id !== st.ws) return back(`fehler=${encodeURIComponent("Sub-Account passt nicht.")}`);
  const acc = await db.channelAccount.findFirst({ where: { id: st.a, workspaceId: st.ws, platform } });
  const connector = connectorFor(platform);
  const code = url.searchParams.get("code");
  if (!acc || !connector?.exchangeCode || !code) return back(`fehler=${encodeURIComponent("Kanal oder Code fehlt.")}`);

  try {
    const { creds, candidates } = await connector.exchangeCode({ code, redirectUri: redirectUri(env.appUrl(), platform as Platform), verifier: st.v });
    const chosen = pickCandidate(candidates, { externalId: acc.externalId, handle: acc.handle });
    const stored = { ...creds, extra: { ...(creds.extra ?? {}), candidates: candidates.map((c) => ({ id: c.id, name: c.name, handle: c.handle ?? null, url: c.url ?? null })) } };
    await db.channelAccount.update({
      where: { id: acc.id },
      data: {
        credentials: sealCredentials(stored),
        tokenExpiresAt: creds.expiresAt ? new Date(creds.expiresAt) : null,
        connection: "api",
        externalId: chosen?.id ?? acc.externalId,
        url: acc.url ?? chosen?.url ?? null,
        lastError: chosen ? null : candidates.length ? "Bitte das zu lesende Konto auswählen." : "Keine passenden Konten mit Admin-Rechten gefunden.",
      },
    });
    await audit({ workspaceId: st.ws, actor: `user:${user.id}`, action: "channel.connected", target: acc.id, detail: { platform, candidates: candidates.length } as Prisma.InputJsonObject });
    return back(`ok=${encodeURIComponent(chosen ? `${acc.handle} verbunden.` : "Verbunden – bitte Konto auswählen.")}`);
  } catch (e) {
    const msg = redact(String(e instanceof Error ? e.message : e), [code]).slice(0, 300);
    await db.channelAccount.update({ where: { id: acc.id }, data: { lastError: msg } });
    return back(`fehler=${encodeURIComponent(msg)}`);
  }
}
