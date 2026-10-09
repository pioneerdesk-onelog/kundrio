import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { aiReferrerFrom, classifyUserAgent, detectDevice, hostOf, languageFrom } from "./bots";

// Gemeinsame Speicherlogik für Beacon, Server-Treffer und Conversions.
// Datenschutz: keine Cookies, keine IP-Speicherung. Die IP fließt nur flüchtig in einen Hash
// mit täglich neuem, zufälligem Salz ein. Alte Salze werden gelöscht → Hashes sind nicht über Tage verknüpfbar.

const MAX_PATH = 300;

const saltCache = new Map<string, string>();

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // UTC-Tag, passt zu CURRENT_DATE der DB (UTC)
}

export async function dailySalt(): Promise<string> {
  const key = todayKey();
  const cached = saltCache.get(key);
  if (cached) return cached;
  const date = new Date(`${key}T00:00:00Z`);
  await db.analyticsSalt.createMany({ data: [{ date, salt: randomBytes(32).toString("hex") }], skipDuplicates: true });
  const row = await db.analyticsSalt.findUniqueOrThrow({ where: { date } });
  saltCache.clear();
  saltCache.set(key, row.salt);
  return row.salt;
}

import { clientIp } from "../client-ip";
export { clientIp };

export async function visitorHash(workspaceId: string, h: Headers): Promise<string> {
  const salt = await dailySalt();
  return createHash("sha256")
    .update(`${salt}|${workspaceId}|${clientIp(h)}|${h.get("user-agent") ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

/** Pfad ohne Query/Fragment, gekürzt. Query-Strings können personenbezogene Daten enthalten. */
export function cleanPath(path: string | null | undefined): string {
  let p = (path ?? "/").split("#")[0].split("?")[0] || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.slice(0, MAX_PATH);
}

const clip = (v: string | null | undefined, n = 100) => (v ? v.trim().slice(0, n) || null : null);

export type EventInput = {
  workspaceId: string;
  kind: "pageview" | "event" | "bot" | "conversion" | "audit";
  name?: string | null;
  host?: string | null;
  path: string;
  pageId?: string | null;
  referrer?: string | null;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null };
  ua?: string | null;
  acceptLanguage?: string | null;
  visitorHash?: string | null;
  contactId?: string | null;
  valueCents?: number | null;
  ts?: Date;
};

/** Baut den Datensatz (klassifiziert UA, Referrer, KI-Quelle) und speichert ihn. */
export async function storeEvent(e: EventInput) {
  // Conversions und Audit-Treffer sind echte Aktionen angemeldeter/handelnder Menschen → nie als Bot werten
  const bot = e.kind === "pageview" || e.kind === "event" || e.kind === "bot" ? classifyUserAgent(e.ua) : null;
  const host = hostOf(e.host ?? null);
  let referrerHost = hostOf(e.referrer ?? null);
  if (referrerHost && host && referrerHost === host) referrerHost = null; // interne Navigation
  const utmSource = clip(e.utm?.source);
  const kind = bot && (e.kind === "pageview" || e.kind === "event") ? "bot" : e.kind;
  const ts = e.ts ?? new Date();

  await db.analyticsEvent.create({
    data: {
      workspaceId: e.workspaceId,
      ts,
      date: new Date(`${todayKey(ts)}T00:00:00Z`),
      kind,
      name: clip(e.name, 120),
      host,
      path: cleanPath(e.path),
      pageId: clip(e.pageId, 40),
      referrerHost,
      utmSource,
      utmMedium: clip(e.utm?.medium),
      utmCampaign: clip(e.utm?.campaign),
      device: bot ? "bot" : detectDevice(e.ua),
      lang: bot ? null : languageFrom(e.acceptLanguage),
      // Bots bekommen keinen Besucher-Hash (werden nicht als Besucher gezählt)
      visitorHash: bot ? null : (e.visitorHash ?? null),
      botCategory: bot?.category ?? null,
      botName: bot?.name ?? null,
      aiReferrer: bot ? null : aiReferrerFrom(referrerHost, utmSource),
      contactId: e.contactId ?? null,
      valueCents: e.valueCents ?? null,
    },
  });
}
