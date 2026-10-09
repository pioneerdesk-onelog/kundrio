// YouTube Data API v3 (öffentliche Kanalstatistik + letzte Videos, API-Schlüssel). Auf den Konnektor-Rahmen umgestellt.
import { BASES, fetchJson } from "./http";
import { num, shortTitle, type Connector } from "./connector";
import type { PostInput } from "./types";
import { ReauthRequiredError } from "./types";

type YtChannel = {
  id: string;
  statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

export function parseYtChannel(json: unknown) {
  const ch = (json as { items?: YtChannel[] })?.items?.[0];
  if (!ch) return null;
  const s = ch.statistics ?? {};
  return {
    id: ch.id,
    uploads: ch.contentDetails?.relatedPlaylists?.uploads ?? null,
    followers: s.hiddenSubscriberCount ? null : num(s.subscriberCount),
    views: num(s.viewCount),
    posts: num(s.videoCount),
  };
}

type YtVideo = { id: string; snippet?: { title?: string; publishedAt?: string }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } };

export function parseYtVideos(json: unknown): PostInput[] {
  return ((json as { items?: YtVideo[] })?.items ?? []).map((v) => ({
    externalId: v.id,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    title: shortTitle(v.snippet?.title),
    publishedAt: v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : null,
    metrics: { views: num(v.statistics?.viewCount) ?? 0, likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount) },
  }));
}

function key() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new ReauthRequiredError("YOUTUBE_API_KEY ist nicht gesetzt.");
  return k;
}

async function channel(account: { externalId: string | null; handle: string }) {
  const k = key();
  const q = new URLSearchParams({ part: "statistics,contentDetails", key: k });
  if (account.externalId) q.set("id", account.externalId);
  else q.set("forHandle", account.handle.startsWith("@") ? account.handle : `@${account.handle}`);
  const ch = parseYtChannel(await fetchJson<unknown>(`${BASES.youtube()}/youtube/v3/channels?${q}`, { secrets: [k] }));
  if (!ch) throw new Error("Kanal bei YouTube nicht gefunden (Kanal-ID oder Handle prüfen).");
  return ch;
}

export const youtube: Connector = {
  platform: "youtube",
  async fetchAccountMetrics(account) {
    const ch = await channel(account);
    return { followers: ch.followers, views: ch.views, posts: ch.posts, extra: { source: "youtube-api" }, externalId: ch.id };
  },
  async fetchPosts(account, _creds, since) {
    const k = key();
    const ch = await channel(account);
    if (!ch.uploads) return [];
    const items = await fetchJson<{ items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[] }>(
      `${BASES.youtube()}/youtube/v3/playlistItems?${new URLSearchParams({ part: "contentDetails", playlistId: ch.uploads, maxResults: "15", key: k })}`,
      { secrets: [k] },
    );
    const ids = (items.items ?? [])
      .filter((i) => !i.contentDetails?.videoPublishedAt || new Date(i.contentDetails.videoPublishedAt) >= since)
      .map((i) => i.contentDetails?.videoId)
      .filter((x): x is string => Boolean(x));
    if (ids.length === 0) return [];
    return parseYtVideos(
      await fetchJson<unknown>(`${BASES.youtube()}/youtube/v3/videos?${new URLSearchParams({ part: "snippet,statistics", id: ids.join(","), key: k })}`, { secrets: [k] }),
    );
  },
};
