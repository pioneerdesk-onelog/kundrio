// X API v2 (nur lesend, App-only Bearer Token). Kostenpflichtig (Pay-per-use) – Anzahl gelesener Beiträge begrenzt.
// Quelle Tarife: Free = nur Schreiben; Neuregistrierungen seit 06.02.2026 Pay-per-use (~0,005 USD je gelesenem Beitrag).
import { BASES, fetchJson } from "./http";
import { num, shortTitle, type Connector } from "./connector";
import type { PostInput } from "./types";
import { ReauthRequiredError } from "./types";

type XUser = { data?: { id: string; username: string; public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number; listed_count?: number } } };
type XTweet = { id: string; text?: string; created_at?: string; public_metrics?: { retweet_count?: number; reply_count?: number; like_count?: number; quote_count?: number; impression_count?: number; bookmark_count?: number } };

export function parseXUser(json: unknown): { id: string; username: string; followers: number | null; posts: number | null } | null {
  const d = (json as XUser)?.data;
  if (!d?.id) return null;
  return { id: d.id, username: d.username, followers: num(d.public_metrics?.followers_count), posts: num(d.public_metrics?.tweet_count) };
}

export function parseXTweets(json: unknown, username: string): PostInput[] {
  return ((json as { data?: XTweet[] })?.data ?? []).map((t) => ({
    externalId: t.id,
    url: `https://x.com/${username}/status/${t.id}`,
    title: shortTitle(t.text),
    publishedAt: t.created_at ? new Date(t.created_at) : null,
    metrics: {
      impressions: num(t.public_metrics?.impression_count),
      likes: num(t.public_metrics?.like_count) ?? 0,
      comments: num(t.public_metrics?.reply_count) ?? 0,
      shares: (num(t.public_metrics?.retweet_count) ?? 0) + (num(t.public_metrics?.quote_count) ?? 0),
    },
  }));
}

function bearer() {
  const t = process.env.X_BEARER_TOKEN;
  if (!t) throw new ReauthRequiredError("X_BEARER_TOKEN ist nicht gesetzt.");
  return t;
}

const handleOf = (h: string) => h.replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, "").split(/[/?]/)[0];

export const x: Connector = {
  platform: "x",
  async fetchAccountMetrics(account) {
    const t = bearer();
    const user = parseXUser(
      await fetchJson<unknown>(`${BASES.x()}/2/users/by/username/${encodeURIComponent(handleOf(account.handle))}?user.fields=public_metrics`, {
        headers: { Authorization: `Bearer ${t}` },
        secrets: [t],
      }),
    );
    if (!user) throw new Error("Konto bei X nicht gefunden (Handle prüfen).");
    return { followers: user.followers, views: null, posts: user.posts, extra: { source: "x-api" }, externalId: user.id };
  },
  async fetchPosts(account, _creds, since) {
    const t = bearer();
    if (!account.externalId) return [];
    const max = Math.min(100, Math.max(5, Number(process.env.X_MAX_POSTS_PER_SYNC ?? 10)));
    const q = new URLSearchParams({
      max_results: String(max),
      "tweet.fields": "created_at,public_metrics",
      exclude: "retweets,replies",
      start_time: since.toISOString(),
    });
    return parseXTweets(
      await fetchJson<unknown>(`${BASES.x()}/2/users/${account.externalId}/tweets?${q}`, { headers: { Authorization: `Bearer ${t}` }, secrets: [t] }),
      handleOf(account.handle),
    );
  },
};
