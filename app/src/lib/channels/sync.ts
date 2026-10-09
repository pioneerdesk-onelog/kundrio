import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { platformInfo, supportsApi } from "./config";
import { connectorFor } from "./registry";
import { openCredentials, redact, sealCredentials } from "./crypto";
import type { AccountMetrics, Credentials, Platform, PostInput } from "./types";
import { ReauthRequiredError, TransientChannelError } from "./types";
import type { MetricRow } from "./import";

// Abruf je Kanal: Token ggf. erneuern → Tageswerte → Beiträge → speichern. Fehler werden am Kanal sichtbar (lastError).
// Abgelaufene Zugänge erzeugen KEINE Wiederholungen (Status „neu verbinden“).

export const REAUTH_PREFIX = "Neu verbinden:";

export function today(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type SyncResult = { ok: true; metrics: AccountMetrics; posts: number } | { ok: false; reauth: boolean; message: string };

const REFRESH_WINDOW_MS = 24 * 3600 * 1000;

async function maybeRefresh(platform: Platform, accountId: string, creds: Credentials): Promise<Credentials> {
  const connector = connectorFor(platform);
  const exp = creds.expiresAt ? new Date(creds.expiresAt).getTime() : null;
  if (exp == null || exp - Date.now() > REFRESH_WINDOW_MS) return creds;
  if (!connector?.refresh) {
    if (exp < Date.now()) throw new ReauthRequiredError("Zugang abgelaufen.");
    return creds;
  }
  const fresh = await connector.refresh(creds);
  const merged: Credentials = { ...fresh, extra: { ...(creds.extra ?? {}), ...(fresh.extra ?? {}) } };
  await db.channelAccount.update({ where: { id: accountId }, data: { credentials: sealCredentials(merged), tokenExpiresAt: merged.expiresAt ? new Date(merged.expiresAt) : null } });
  return merged;
}

export async function saveMetric(accountId: string, date: Date, m: Pick<AccountMetrics, "followers" | "views" | "posts"> & { extra?: Record<string, unknown> }) {
  const data = { followers: m.followers, views: m.views, posts: m.posts, extra: (m.extra ?? {}) as Prisma.InputJsonValue };
  await db.channelMetric.upsert({ where: { accountId_date: { accountId, date } }, create: { accountId, date, ...data }, update: data });
}

export async function savePosts(workspaceId: string, accountId: string, posts: PostInput[]) {
  for (const p of posts.slice(0, 200)) {
    const data = { url: p.url, title: p.title, publishedAt: p.publishedAt, metrics: p.metrics as Prisma.InputJsonValue, fetchedAt: new Date() };
    await db.channelPost.upsert({
      where: { accountId_externalId: { accountId, externalId: p.externalId } },
      create: { workspaceId, accountId, externalId: p.externalId, ...data },
      update: data,
    });
  }
}

/** Ruft einen Kanal ab. Wirft nur bei vorübergehenden Fehlern (für Job-Wiederholung). */
export async function syncAccount(accountId: string, workspaceId?: string): Promise<SyncResult> {
  const acc = await db.channelAccount.findFirst({ where: { id: accountId, ...(workspaceId ? { workspaceId } : {}) } });
  if (!acc) return { ok: false, reauth: false, message: "Kanal nicht gefunden." };
  const platform = acc.platform as Platform;
  const connector = connectorFor(platform);
  const info = platformInfo(platform);
  if (!connector || !supportsApi(platform)) return { ok: false, reauth: false, message: "Für diese Plattform gibt es keine Schnittstelle – bitte manuell eintragen oder Export importieren." };
  if (!info.configured) return { ok: false, reauth: false, message: `Schnittstelle nicht eingerichtet (${info.envVars.join(", ")}).` };

  let creds = openCredentials(acc.credentials);
  const secrets = [creds?.accessToken, creds?.refreshToken];
  try {
    if (info.mode === "oauth") {
      if (!creds) throw new ReauthRequiredError("Kanal ist noch nicht verbunden.");
      creds = await maybeRefresh(platform, acc.id, creds);
    }
    const ref = { externalId: acc.externalId, handle: acc.handle };
    const metrics = await connector.fetchAccountMetrics(ref, creds);
    const externalId = acc.externalId ?? metrics.externalId ?? null;
    await saveMetric(acc.id, today(), metrics);
    // Beiträge der letzten 90 Tage (bei Erstabruf) bzw. seit letztem Abruf minus 14 Tage (Kennzahlen ändern sich noch)
    const since = acc.lastSyncAt ? new Date(acc.lastSyncAt.getTime() - 14 * 864e5) : new Date(Date.now() - 90 * 864e5);
    let posts: PostInput[] = [];
    try {
      posts = await connector.fetchPosts({ externalId, handle: acc.handle }, creds, since);
      await savePosts(acc.workspaceId, acc.id, posts);
    } catch (e) {
      if (e instanceof ReauthRequiredError || e instanceof TransientChannelError) throw e;
      // Beiträge optional – Tageswerte sind gespeichert
      metrics.extra = { ...metrics.extra, postsError: redact(String(e instanceof Error ? e.message : e), secrets).slice(0, 200) };
    }
    await db.channelAccount.update({
      where: { id: acc.id },
      data: { lastSyncAt: new Date(), lastError: null, externalId, connection: info.mode === "import" ? acc.connection : "api" },
    });
    return { ok: true, metrics, posts: posts.length };
  } catch (e) {
    const text = redact(String(e instanceof Error ? e.message : e), secrets).slice(0, 500);
    if (e instanceof ReauthRequiredError) {
      await db.channelAccount.update({ where: { id: acc.id }, data: { lastError: `${REAUTH_PREFIX} ${text}` } });
      return { ok: false, reauth: true, message: text };
    }
    await db.channelAccount.update({ where: { id: acc.id }, data: { lastError: text } });
    if (e instanceof TransientChannelError) throw e;
    return { ok: false, reauth: false, message: text };
  }
}

/** Import-Ergebnis speichern (Tageswerte oder Beiträge). */
export async function applyImport(accountId: string, workspaceId: string, payload: { metrics?: MetricRow[]; posts?: PostInput[] }) {
  const acc = await db.channelAccount.findFirst({ where: { id: accountId, workspaceId } });
  if (!acc) throw new Error("Kanal nicht gefunden.");
  let n = 0;
  for (const m of payload.metrics ?? []) {
    await saveMetric(acc.id, m.date, { followers: m.followers, views: m.views, posts: m.posts, extra: { source: "import" } });
    n++;
  }
  if (payload.posts?.length) {
    await savePosts(workspaceId, acc.id, payload.posts);
    n += payload.posts.length;
  }
  await db.channelAccount.update({ where: { id: acc.id }, data: { connection: acc.connection === "manual" ? "import" : acc.connection } });
  return n;
}
