// LinkedIn Community Management API (Organisationsseiten, nur lesend).
// Quellen: learn.microsoft.com/linkedin/marketing/community-management/organizations/{follower-statistics,share-statistics,organization-lookup-api}
import { BASES, fetchJson } from "./http";
import { isoIn, num, shortTitle, type Connector } from "./connector";
import type { AccountCandidate, Credentials, PostInput } from "./types";
import { ReauthRequiredError } from "./types";

const SCOPES = ["rw_organization_admin", "r_organization_social"];

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Linkedin-Version": process.env.LINKEDIN_API_VERSION ?? "202609",
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

const orgUrn = (id: string) => (id.startsWith("urn:li:organization:") ? id : `urn:li:organization:${id}`);
const orgId = (idOrUrn: string) => idOrUrn.replace("urn:li:organization:", "");

// ---------- Parser (rein, getestet) ----------

export function parseNetworkSize(json: unknown): number | null {
  return num((json as { firstDegreeSize?: unknown })?.firstDegreeSize);
}

export type LiShareStats = { impressionCount?: number; uniqueImpressionsCount?: number; clickCount?: number; likeCount?: number; commentCount?: number; shareCount?: number; engagement?: number };

/** Lifetime-Statistik der Organisation (ohne timeIntervals). */
export function parseLifetimeShareStats(json: unknown): LiShareStats | null {
  const el = (json as { elements?: { totalShareStatistics?: LiShareStats; share?: string; ugcPost?: string }[] })?.elements ?? [];
  const agg = el.find((e) => !e.share && !e.ugcPost) ?? el[0];
  return agg?.totalShareStatistics ?? null;
}

/** Statistik je Beitrag (shares=List(...) bzw. ugcPosts=List(...)) → Map URN → Werte. Fehlende = 0 laut Doku. */
export function parsePostShareStats(json: unknown): Map<string, LiShareStats> {
  const map = new Map<string, LiShareStats>();
  const el = (json as { elements?: { totalShareStatistics?: LiShareStats; share?: string; ugcPost?: string }[] })?.elements ?? [];
  for (const e of el) {
    const key = e.share ?? e.ugcPost;
    if (key && e.totalShareStatistics) map.set(key, e.totalShareStatistics);
  }
  return map;
}

export function parseAdminOrgs(json: unknown): string[] {
  const el = (json as { elements?: { organization?: string; organizationTarget?: string }[] })?.elements ?? [];
  return [...new Set(el.map((e) => e.organization ?? e.organizationTarget).filter((x): x is string => Boolean(x)))];
}

export type LiPost = { id: string; commentary?: string; createdAt?: number; publishedAt?: number; lifecycleState?: string };

export function parsePosts(json: unknown): LiPost[] {
  return ((json as { elements?: LiPost[] })?.elements ?? []).filter((p) => p.id && p.lifecycleState !== "DELETED");
}

export function toPostInputs(posts: LiPost[], stats: Map<string, LiShareStats>): PostInput[] {
  return posts.map((p) => {
    const s = stats.get(p.id) ?? {};
    const ts = p.publishedAt ?? p.createdAt;
    return {
      externalId: p.id,
      url: `https://www.linkedin.com/feed/update/${encodeURIComponent(p.id)}/`,
      title: shortTitle(p.commentary),
      publishedAt: ts ? new Date(ts) : null,
      metrics: {
        impressions: num(s.impressionCount) ?? 0,
        clicks: num(s.clickCount) ?? 0,
        likes: num(s.likeCount) ?? 0,
        comments: num(s.commentCount) ?? 0,
        shares: num(s.shareCount) ?? 0,
        engagementRate: num(s.engagement),
      },
    };
  });
}

// ---------- Konnektor ----------

async function tokenRequest(body: URLSearchParams): Promise<Credentials> {
  const secret = process.env.LINKEDIN_CLIENT_SECRET;
  const t = await fetchJson<{ access_token: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number }>(
    `${BASES.linkedinAuth()}/oauth/v2/accessToken`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, secrets: [secret] },
  );
  if (!t.access_token) throw new Error("LinkedIn lieferte kein Zugangstoken.");
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: isoIn(t.expires_in), refreshExpiresAt: isoIn(t.refresh_token_expires_in) };
}

export const linkedin: Connector = {
  platform: "linkedin",

  authorizeUrl({ redirectUri, state }) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: process.env.LINKEDIN_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(" "),
    });
    return `${BASES.linkedinAuth()}/oauth/v2/authorization?${q}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const creds = await tokenRequest(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID ?? "",
        client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? "",
      }),
    );
    // Organisationen, die der verbindende Benutzer administriert
    const acls = await fetchJson<unknown>(
      `${BASES.linkedinApi()}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
      { headers: headers(creds.accessToken), secrets: [creds.accessToken] },
    );
    const candidates: AccountCandidate[] = [];
    for (const urn of parseAdminOrgs(acls).slice(0, 25)) {
      try {
        const org = await fetchJson<{ localizedName?: string; vanityName?: string }>(`${BASES.linkedinApi()}/rest/organizations/${orgId(urn)}`, {
          headers: headers(creds.accessToken),
          secrets: [creds.accessToken],
        });
        candidates.push({ id: orgId(urn), name: org.localizedName ?? urn, handle: org.vanityName ?? null, url: org.vanityName ? `https://www.linkedin.com/company/${org.vanityName}/` : null });
      } catch {
        candidates.push({ id: orgId(urn), name: urn });
      }
    }
    return { creds, candidates };
  },

  async refresh(creds) {
    if (!creds.refreshToken) throw new ReauthRequiredError("LinkedIn-Zugang abgelaufen – bitte neu verbinden (kein Refresh-Token).");
    return tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: process.env.LINKEDIN_CLIENT_ID ?? "",
        client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? "",
      }),
    );
  },

  async fetchAccountMetrics(account, creds) {
    if (!creds) throw new ReauthRequiredError("LinkedIn ist nicht verbunden.");
    if (!account.externalId) throw new Error("Bitte die LinkedIn-Seite auswählen.");
    const urn = orgUrn(account.externalId);
    const h = { headers: headers(creds.accessToken), secrets: [creds.accessToken] };
    const size = await fetchJson<unknown>(`${BASES.linkedinApi()}/rest/networkSizes/${encodeURIComponent(urn)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, h);
    let stats: LiShareStats | null = null;
    try {
      stats = parseLifetimeShareStats(
        await fetchJson<unknown>(`${BASES.linkedinApi()}/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(urn)}`, h),
      );
    } catch {
      stats = null; // Statistik optional – Follower genügen
    }
    return {
      followers: parseNetworkSize(size),
      // Gesamte organische Impressionen (laufende Summe der letzten 12 Monate laut LinkedIn)
      views: num(stats?.impressionCount),
      posts: null,
      extra: { source: "linkedin-api", clicks: num(stats?.clickCount), engagement: num(stats?.engagement) },
    };
  },

  async fetchPosts(account, creds, since) {
    if (!creds || !account.externalId) return [];
    const urn = orgUrn(account.externalId);
    const h = { headers: headers(creds.accessToken), secrets: [creds.accessToken] };
    const posts = parsePosts(
      await fetchJson<unknown>(`${BASES.linkedinApi()}/rest/posts?author=${encodeURIComponent(urn)}&q=author&count=20&sortBy=LAST_MODIFIED`, h),
    ).filter((p) => (p.publishedAt ?? p.createdAt ?? Date.now()) >= since.getTime());
    if (posts.length === 0) return [];
    const shares = posts.filter((p) => p.id.startsWith("urn:li:share:")).map((p) => encodeURIComponent(p.id));
    const ugc = posts.filter((p) => p.id.startsWith("urn:li:ugcPost:")).map((p) => encodeURIComponent(p.id));
    const stats = new Map<string, LiShareStats>();
    const base = `${BASES.linkedinApi()}/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(urn)}`;
    if (shares.length) for (const [k, v] of parsePostShareStats(await fetchJson<unknown>(`${base}&shares=List(${shares.join(",")})`, h))) stats.set(k, v);
    if (ugc.length) for (const [k, v] of parsePostShareStats(await fetchJson<unknown>(`${base}&ugcPosts=List(${ugc.join(",")})`, h))) stats.set(k, v);
    return toPostInputs(posts, stats);
  },
};
