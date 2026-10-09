import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { aiReferrerFrom, classifyUserAgent, detectDevice, hostOf } from "./bots";
import { isInterestingPath, parseLogLine } from "./logparse";
import { cleanPath } from "./store";

export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const IMPORT_CHUNK_BYTES = 2 * 1024 * 1024;

export type ImportResult = { lines: number; imported: number; duplicates: number; ignored: number; invalid: number };

/**
 * Importiert Bot-Treffer und Besuche aus KI-Antworten aus einem Access-Log.
 * Keine IP-Speicherung, kein Besucher-Hash (historische Salze existieren nicht mehr).
 * Doppelte Importe derselben Zeile werden über einen Zeilen-Hash im Feld `name` erkannt („import:<hash>“).
 */
export async function importLogText(workspaceId: string, text: string, ownHost?: string | null): Promise<ImportResult> {
  const res: ImportResult = { lines: 0, imported: 0, duplicates: 0, ignored: 0, invalid: 0 };
  const rows: (Prisma.AnalyticsEventCreateManyInput & { name: string })[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    res.lines++;
    const hit = parseLogLine(line);
    if (!hit) { res.invalid++; continue; }
    if (!isInterestingPath(hit.path) || hit.method === "OPTIONS" || hit.method === "HEAD") { res.ignored++; continue; }

    const bot = classifyUserAgent(hit.ua);
    const referrerHost = hostOf(hit.referer);
    const url = new URL(hit.path, "http://x");
    const utmSource = url.searchParams.get("utm_source");
    const ai = bot ? null : aiReferrerFrom(referrerHost, utmSource);
    // Menschen zählt der Beacon; aus Logs nur Bots und Besuche aus KI-Antworten übernehmen
    if (!bot && !ai) { res.ignored++; continue; }
    if (!bot && hit.status >= 400) { res.ignored++; continue; }

    const host = hostOf(hit.host) ?? hostOf(ownHost ?? null);
    rows.push({
      workspaceId,
      ts: hit.ts,
      date: new Date(`${hit.ts.toISOString().slice(0, 10)}T00:00:00Z`),
      kind: bot ? "bot" : "pageview",
      name: `import:${createHash("sha256").update(`${workspaceId}|${line}`).digest("hex").slice(0, 32)}`,
      host,
      path: cleanPath(hit.path),
      referrerHost: referrerHost && referrerHost !== host ? referrerHost : null,
      utmSource: utmSource?.slice(0, 100) || null,
      utmMedium: url.searchParams.get("utm_medium")?.slice(0, 100) || null,
      utmCampaign: url.searchParams.get("utm_campaign")?.slice(0, 100) || null,
      device: bot ? "bot" : detectDevice(hit.ua),
      botCategory: bot?.category ?? null,
      botName: bot?.name ?? null,
      aiReferrer: ai,
    });
  }

  // In Blöcken auf Dubletten prüfen und speichern
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const names = batch.map((r) => r.name);
    const existing = new Set(
      (await db.analyticsEvent.findMany({ where: { workspaceId, name: { in: names } }, select: { name: true } })).map((e) => e.name),
    );
    const seen = new Set<string>();
    const fresh = batch.filter((r) => {
      const n = r.name;
      if (existing.has(n) || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    res.duplicates += batch.length - fresh.length;
    if (fresh.length) res.imported += (await db.analyticsEvent.createMany({ data: fresh })).count;
  }
  return res;
}

/** Teilt großen Text an Zeilengrenzen in Blöcke von höchstens `max` Bytes. */
export function splitChunks(text: string, max = IMPORT_CHUNK_BYTES): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let size = 0;
  for (const line of text.split(/\r?\n/)) {
    const len = Buffer.byteLength(line) + 1;
    if (size + len > max && buf.length) {
      out.push(buf.join("\n"));
      buf = [];
      size = 0;
    }
    buf.push(line);
    size += len;
  }
  if (buf.length) out.push(buf.join("\n"));
  return out;
}
