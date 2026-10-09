// Meta Graph API: Facebook-Seiten und Instagram Business/Creator (nur lesend).
// Quellen: developers.facebook.com/docs/{permissions,insights/overview,instagram-platform/insights};
// Page-Insights-Abkündigung 15.06.2026 (Impressions → Views, Fans → Follower).
import { BASES, fetchJson } from "./http";
import { isoIn, num, shortTitle, type Connector } from "./connector";
import type { AccountCandidate, Credentials, PostInput } from "./types";
import { ReauthRequiredError } from "./types";

const ver = () => process.env.META_GRAPH_VERSION ?? "v23.0";
const graph = (path: string) => `${BASES.meta()}/${ver()}${path}`;

export const FB_SCOPES = ["pages_show_list", "pages_read_engagement", "read_insights"];
export const IG_SCOPES = ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_manage_insights"];

// ---------- Parser ----------

type MeAccount = { id: string; name: string; access_token?: string; link?: string; instagram_business_account?: { id: string; username?: string } };

export function parsePages(json: unknown): { pages: AccountCandidate[]; instagram: AccountCandidate[] } {
  const data = (json as { data?: MeAccount[] })?.data ?? [];
  const pages = data.map((p) => ({ id: p.id, name: p.name, url: p.link ?? `https://www.facebook.com/${p.id}`, token: p.access_token }));
  const instagram = data
    .filter((p) => p.instagram_business_account?.id)
    .map((p) => ({
      id: p.instagram_business_account!.id,
      name: p.instagram_business_account!.username ? `@${p.instagram_business_account!.username}` : `Instagram von ${p.name}`,
      handle: p.instagram_business_account!.username ?? null,
      url: p.instagram_business_account!.username ? `https://www.instagram.com/${p.instagram_business_account!.username}/` : null,
      token: p.access_token, // IG-Abfragen laufen mit dem Token der verknüpften Seite
    }));
  return { pages, instagram };
}

/** Summe des letzten Werts je Insights-Metrik (period=day) bzw. total_value. */
export function parseInsightValue(json: unknown, metric: string): number | null {
  const data = (json as { data?: { name: string; values?: { value: unknown }[]; total_value?: { value: unknown } }[] })?.data ?? [];
  const m = data.find((d) => d.name === metric);
  if (!m) return null;
  if (m.total_value) return num(m.total_value.value);
  const last = m.values?.[m.values.length - 1];
  return num(last?.value);
}

type FbPost = { id: string; message?: string; created_time?: string; permalink_url?: string; shares?: { count?: number }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } };

export function parseFbPosts(json: unknown): PostInput[] {
  return ((json as { data?: FbPost[] })?.data ?? []).map((p) => ({
    externalId: p.id,
    url: p.permalink_url ?? null,
    title: shortTitle(p.message),
    publishedAt: p.created_time ? new Date(p.created_time) : null,
    metrics: { likes: num(p.reactions?.summary?.total_count) ?? 0, comments: num(p.comments?.summary?.total_count) ?? 0, shares: num(p.shares?.count) ?? 0 },
  }));
}

type IgMedia = { id: string; caption?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number };

export function parseIgMedia(json: unknown): PostInput[] {
  return ((json as { data?: IgMedia[] })?.data ?? []).map((m) => ({
    externalId: m.id,
    url: m.permalink ?? null,
    title: shortTitle(m.caption),
    publishedAt: m.timestamp ? new Date(m.timestamp) : null,
    metrics: { likes: num(m.like_count) ?? 0, comments: num(m.comments_count) ?? 0 },
  }));
}

// ---------- gemeinsame OAuth-Logik ----------

function authorize(scopes: string[], redirectUri: string, state: string) {
  const q = new URLSearchParams({ client_id: process.env.META_APP_ID ?? "", redirect_uri: redirectUri, state, response_type: "code", scope: scopes.join(",") });
  return `${BASES.metaDialog()}/${ver()}/dialog/oauth?${q}`;
}

async function exchange(code: string, redirectUri: string): Promise<{ creds: Credentials; pages: AccountCandidate[]; instagram: AccountCandidate[] }> {
  const secret = process.env.META_APP_SECRET ?? "";
  const id = process.env.META_APP_ID ?? "";
  const short = await fetchJson<{ access_token: string }>(
    graph(`/oauth/access_token?${new URLSearchParams({ client_id: id, client_secret: secret, redirect_uri: redirectUri, code })}`),
    { secrets: [secret] },
  );
  // Langlebiges Benutzer-Token (~60 Tage); daraus abgeleitete Seiten-Tokens laufen nicht ab
  const long = await fetchJson<{ access_token: string; expires_in?: number }>(
    graph(`/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: short.access_token })}`),
    { secrets: [secret, short.access_token] },
  );
  const accounts = await fetchJson<unknown>(
    graph(`/me/accounts?${new URLSearchParams({ fields: "id,name,link,access_token,instagram_business_account{id,username}", limit: "100", access_token: long.access_token })}`),
    { secrets: [long.access_token] },
  );
  const { pages, instagram } = parsePages(accounts);
  const tokens: Record<string, string> = {};
  for (const c of [...pages, ...instagram]) if (c.token) tokens[c.id] = c.token;
  const strip = (cs: AccountCandidate[]) => cs.map(({ token: _t, ...rest }) => rest);
  return {
    creds: { accessToken: long.access_token, expiresAt: isoIn(long.expires_in), extra: { accountTokens: tokens } },
    pages: strip(pages),
    instagram: strip(instagram),
  };
}

function accountToken(creds: Credentials | null, externalId: string | null): string {
  if (!creds) throw new ReauthRequiredError("Meta ist nicht verbunden.");
  if (!externalId) throw new Error("Bitte Seite bzw. Instagram-Konto auswählen.");
  const t = (creds.extra?.accountTokens as Record<string, string> | undefined)?.[externalId];
  if (!t) throw new ReauthRequiredError("Für dieses Konto liegt kein Zugang vor – bitte neu verbinden.");
  return t;
}

const daysAgo = (d: number) => Math.floor((Date.now() - d * 864e5) / 1000);

export const facebook: Connector = {
  platform: "facebook",
  authorizeUrl: ({ redirectUri, state }) => authorize(FB_SCOPES, redirectUri, state),
  async exchangeCode({ code, redirectUri }) {
    const r = await exchange(code, redirectUri);
    return { creds: r.creds, candidates: r.pages };
  },
  async fetchAccountMetrics(account, creds) {
    const token = accountToken(creds, account.externalId);
    const page = await fetchJson<{ followers_count?: number; fan_count?: number }>(
      graph(`/${account.externalId}?${new URLSearchParams({ fields: "followers_count,fan_count", access_token: token })}`),
      { secrets: [token] },
    );
    let views: number | null = null;
    try {
      // Nachfolger von page_impressions seit 06/2026: page_media_view (Views)
      views = parseInsightValue(
        await fetchJson<unknown>(graph(`/${account.externalId}/insights?${new URLSearchParams({ metric: "page_media_view", period: "day", access_token: token })}`), { secrets: [token] }),
        "page_media_view",
      );
    } catch {
      views = null;
    }
    return { followers: num(page.followers_count) ?? num(page.fan_count), views, posts: null, extra: { source: "meta-api", viewsPeriod: "day" } };
  },
  async fetchPosts(account, creds, since) {
    const token = accountToken(creds, account.externalId);
    const fields = "id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";
    return parseFbPosts(
      await fetchJson<unknown>(
        graph(`/${account.externalId}/posts?${new URLSearchParams({ fields, limit: "20", since: String(Math.floor(since.getTime() / 1000)), access_token: token })}`),
        { secrets: [token] },
      ),
    );
  },
};

export const instagram: Connector = {
  platform: "instagram",
  authorizeUrl: ({ redirectUri, state }) => authorize(IG_SCOPES, redirectUri, state),
  async exchangeCode({ code, redirectUri }) {
    const r = await exchange(code, redirectUri);
    return { creds: r.creds, candidates: r.instagram };
  },
  async fetchAccountMetrics(account, creds) {
    const token = accountToken(creds, account.externalId);
    const user = await fetchJson<{ followers_count?: number; media_count?: number; username?: string }>(
      graph(`/${account.externalId}?${new URLSearchParams({ fields: "followers_count,media_count,username", access_token: token })}`),
      { secrets: [token] },
    );
    let views: number | null = null;
    try {
      views = parseInsightValue(
        await fetchJson<unknown>(
          graph(`/${account.externalId}/insights?${new URLSearchParams({ metric: "views", period: "day", metric_type: "total_value", since: String(daysAgo(1)), until: String(daysAgo(0)), access_token: token })}`),
          { secrets: [token] },
        ),
        "views",
      );
    } catch {
      views = null;
    }
    return { followers: num(user.followers_count), views, posts: num(user.media_count), extra: { source: "meta-api", username: user.username ?? null, viewsPeriod: "day" } };
  },
  async fetchPosts(account, creds, since) {
    const token = accountToken(creds, account.externalId);
    const posts = parseIgMedia(
      await fetchJson<unknown>(
        graph(`/${account.externalId}/media?${new URLSearchParams({ fields: "id,caption,permalink,timestamp,like_count,comments_count", limit: "20", access_token: token })}`),
        { secrets: [token] },
      ),
    );
    return posts.filter((p) => !p.publishedAt || p.publishedAt >= since);
  },
};
