import "server-only";
import { db } from "@/lib/db";
import { classifyUserAgent } from "./bots";
import { cleanPath, storeEvent, visitorHash } from "./store";
import { errMessage, log } from "@/lib/log";

export type HitInput = {
  workspaceId: string;
  path: string;
  pageId?: string;
  /** Request-Header (z. B. aus `await headers()`), für User-Agent, Sprache, Referrer, IP (nur flüchtig) */
  headers: Headers;
};

/**
 * Serverseitig erfassen, wenn ein BOT eine öffentliche Seite abruft (Bots führen kein JS aus).
 * Menschen werden NICHT hier gezählt (das macht der Beacon), damit nichts doppelt zählt.
 * Darf nie werfen und den Seitenaufbau nicht verzögern.
 */
export async function recordServerHit(input: HitInput): Promise<void> {
  try {
    const ua = input.headers.get("user-agent");
    if (!classifyUserAgent(ua)) return;
    // Nicht auf das Speichern warten: Seitenaufbau soll nicht verzögert werden
    void storeEvent({
      workspaceId: input.workspaceId,
      kind: "bot",
      host: input.headers.get("x-forwarded-host") ?? input.headers.get("host"),
      path: input.path,
      pageId: input.pageId,
      referrer: input.headers.get("referer"),
      ua,
    }).catch((err) => log.warn("analytics bot hit not stored", { error: errMessage(err) }));
  } catch (err) {
    log.warn("analytics recordServerHit failed", { error: errMessage(err) });
  }
}

/** Conversion (z. B. Formular gesendet, Agent-Anfrage) mit Kontakt verknüpfen. Darf nie werfen. */
export async function recordConversion(input: HitInput & { contactId: string; name: string; valueCents?: number }): Promise<void> {
  try {
    const h = input.headers;
    const hash = await visitorHash(input.workspaceId, h);
    // Quelle ohne Cookie zuordnen: erster Seitenaufruf desselben Besuchers am selben Tag
    const first = await db.analyticsEvent.findFirst({
      where: { workspaceId: input.workspaceId, visitorHash: hash, kind: "pageview", date: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) },
      orderBy: { ts: "asc" },
      select: { referrerHost: true, utmSource: true, utmMedium: true, utmCampaign: true, host: true },
    });
    await storeEvent({
      workspaceId: input.workspaceId,
      kind: "conversion",
      name: input.name,
      host: first?.host ?? h.get("x-forwarded-host") ?? h.get("host"),
      path: cleanPath(input.path),
      pageId: input.pageId,
      // Bei bekanntem Erstbesuch dessen Quelle übernehmen, sonst Referrer der Anfrage (oft die eigene Seite → intern)
      referrer: first ? first.referrerHost : h.get("referer"),
      utm: first ? { source: first.utmSource, medium: first.utmMedium, campaign: first.utmCampaign } : undefined,
      // UA nur zur Geräteerkennung (storeEvent wertet Conversions nie als Bot)
      ua: h.get("user-agent"),
      acceptLanguage: h.get("accept-language"),
      visitorHash: hash,
      contactId: input.contactId,
      valueCents: input.valueCents ?? null,
    });
  } catch (err) {
    log.warn("analytics recordConversion failed", { error: errMessage(err) });
  }
}
