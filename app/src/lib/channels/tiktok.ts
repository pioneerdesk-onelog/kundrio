// TikTok Display API (eigenes Konto, nur lesend). Quellen: developers.tiktok.com/doc/{display-api-get-started,tiktok-api-v2-get-user-info,tiktok-api-v2-video-object}
import { BASES, fetchJson } from "./http";
import { isoIn, num, shortTitle, type Connector } from "./connector";
import type { Credentials, PostInput } from "./types";
import { ReauthRequiredError } from "./types";

const SCOPES = ["user.info.basic", "user.info.stats", "video.list"];

type Wrapped<T> = { data?: T; error?: { code?: string; message?: string } };

/** TikTok liefert Fehler im Body (error.code != "ok") – hier vereinheitlicht. */
export function unwrap<T>(json: unknown): T {
  const w = json as Wrapped<T>;
  const code = w?.error?.code;
  if (code && code !== "ok") {
    if (/access_token_invalid|scope_not_authorized|token/i.test(code)) throw new ReauthRequiredError(`TikTok: ${code} – bitte neu verbinden.`);
    throw new Error(`TikTok: ${code} ${w.error?.message ?? ""}`.trim());
  }
  return (w?.data ?? {}) as T;
}

type TtUser = { user?: { open_id?: string; display_name?: string; username?: string; follower_count?: number; likes_count?: number; video_count?: number } };
type TtVideo = { id: string; title?: string; create_time?: number; share_url?: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number };

export function parseTtUser(json: unknown) {
  const u = unwrap<TtUser>(json).user ?? {};
  return { openId: u.open_id ?? null, username: u.username ?? null, followers: num(u.follower_count), posts: num(u.video_count), likes: num(u.likes_count) };
}

export function parseTtVideos(json: unknown): PostInput[] {
  const d = unwrap<{ videos?: TtVideo[] }>(json);
  return (d.videos ?? []).map((v) => ({
    externalId: v.id,
    url: v.share_url ?? null,
    title: shortTitle(v.title),
    publishedAt: v.create_time ? new Date(v.create_time * 1000) : null,
    metrics: { views: num(v.view_count) ?? 0, likes: num(v.like_count) ?? 0, comments: num(v.comment_count) ?? 0, shares: num(v.share_count) ?? 0 },
  }));
}

async function tokenRequest(body: URLSearchParams): Promise<Credentials> {
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  const t = await fetchJson<{ access_token?: string; expires_in?: number; refresh_token?: string; refresh_expires_in?: number; open_id?: string; error?: string }>(
    `${BASES.tiktokApi()}/v2/oauth/token/`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, secrets: [secret] },
  );
  if (!t.access_token) throw new ReauthRequiredError(`TikTok lieferte kein Token${t.error ? ` (${t.error})` : ""}.`);
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: isoIn(t.expires_in), refreshExpiresAt: isoIn(t.refresh_expires_in), extra: { openId: t.open_id ?? null } };
}

export const tiktok: Connector = {
  platform: "tiktok",
  authorizeUrl({ redirectUri, state }) {
    const q = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY ?? "", scope: SCOPES.join(","), response_type: "code", redirect_uri: redirectUri, state });
    return `${BASES.tiktokAuth()}/v2/auth/authorize/?${q}`;
  },
  async exchangeCode({ code, redirectUri }) {
    const creds = await tokenRequest(
      new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY ?? "", client_secret: process.env.TIKTOK_CLIENT_SECRET ?? "", code, grant_type: "authorization_code", redirect_uri: redirectUri }),
    );
    const openId = String(creds.extra?.openId ?? "");
    return { creds, candidates: openId ? [{ id: openId, name: "Eigenes TikTok-Konto" }] : [] };
  },
  async refresh(creds) {
    if (!creds.refreshToken) throw new ReauthRequiredError("TikTok-Zugang abgelaufen – bitte neu verbinden.");
    return tokenRequest(
      new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY ?? "", client_secret: process.env.TIKTOK_CLIENT_SECRET ?? "", grant_type: "refresh_token", refresh_token: creds.refreshToken }),
    );
  },
  async fetchAccountMetrics(_account, creds) {
    if (!creds) throw new ReauthRequiredError("TikTok ist nicht verbunden.");
    const u = parseTtUser(
      await fetchJson<unknown>(`${BASES.tiktokApi()}/v2/user/info/?fields=open_id,display_name,username,follower_count,likes_count,video_count`, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        secrets: [creds.accessToken],
      }),
    );
    return { followers: u.followers, views: null, posts: u.posts, extra: { source: "tiktok-api", likes: u.likes }, externalId: u.openId ?? undefined };
  },
  async fetchPosts(_account, creds, since) {
    if (!creds) return [];
    const vids = parseTtVideos(
      await fetchJson<unknown>(`${BASES.tiktokApi()}/v2/video/list/?fields=id,title,create_time,share_url,view_count,like_count,comment_count,share_count`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ max_count: 20 }),
        secrets: [creds.accessToken],
      }),
    );
    return vids.filter((v) => !v.publishedAt || v.publishedAt >= since);
  },
};
