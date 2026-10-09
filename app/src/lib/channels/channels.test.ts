import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.APP_SECRET = process.env.APP_SECRET ?? "test-secret-test-secret-test-secret-1234";
});

import { parseLifetimeShareStats, parseNetworkSize, parsePostShareStats, parsePosts, toPostInputs, parseAdminOrgs } from "./linkedin";
import { parseFbPosts, parseIgMedia, parseInsightValue, parsePages } from "./meta";
import { parseXTweets, parseXUser } from "./x";
import { parseTtUser, parseTtVideos, unwrap } from "./tiktok";
import { parseYtChannel, parseYtVideos } from "./youtube";
import { createState, verifyState, sealCredentials, openCredentials, redact, challengeFor, pkcePair } from "./crypto";
import { detectKind, parseDate, parseExport, parseNumber, suggestMapping, toMetricRows, toPostRows } from "./import";
import { pickCandidate } from "./candidates";
import { platformInfo, redirectUri } from "./config";
import { ReauthRequiredError } from "./types";

// Fixtures nach den Beispielantworten der offiziellen Dokumentationen (LinkedIn Learn, Meta for Developers, X, TikTok, YouTube).

describe("LinkedIn-Parser", () => {
  it("Follower-Anzahl aus networkSizes", () => {
    expect(parseNetworkSize({ firstDegreeSize: 219145 })).toBe(219145);
    expect(parseNetworkSize({})).toBeNull();
  });
  it("Lifetime-Statistik und Beitragsstatistik", () => {
    const life = parseLifetimeShareStats({
      paging: { count: 10, start: 0 },
      elements: [{ totalShareStatistics: { uniqueImpressionsCount: 9327, clickCount: 109276, engagement: 0.0075, likeCount: 52, commentCount: 70, shareCount: 0, impressionCount: 14490816 }, organizationalEntity: "urn:li:organization:2414183" }],
    });
    expect(life?.impressionCount).toBe(14490816);
    const per = parsePostShareStats({
      elements: [
        { organizationalEntity: "urn:li:organization:2414183", share: "urn:li:share:1000000", totalShareStatistics: { clickCount: 78, commentCount: 24, engagement: 0.0228, impressionCount: 5287, likeCount: 14, shareCount: 5 } },
      ],
    });
    expect(per.get("urn:li:share:1000000")?.likeCount).toBe(14);
  });
  it("Admin-Organisationen und Beiträge → Kennzahlen (fehlende Statistik = 0)", () => {
    expect(parseAdminOrgs({ elements: [{ organization: "urn:li:organization:1" }, { organization: "urn:li:organization:1" }, { organizationTarget: "urn:li:organization:2" }] })).toEqual([
      "urn:li:organization:1",
      "urn:li:organization:2",
    ]);
    const posts = parsePosts({ elements: [{ id: "urn:li:share:1", commentary: "Neues Produkt", publishedAt: 1759300000000 }, { id: "urn:li:share:2", lifecycleState: "DELETED" }] });
    expect(posts).toHaveLength(1);
    const inputs = toPostInputs(posts, new Map());
    expect(inputs[0].metrics.likes).toBe(0);
    expect(inputs[0].url).toContain("linkedin.com/feed/update/");
  });
});

describe("Meta-Parser", () => {
  it("Seiten und verknüpfte Instagram-Konten", () => {
    const r = parsePages({ data: [{ id: "111", name: "OneLog", access_token: "PAGE_TOKEN", instagram_business_account: { id: "1784", username: "onelog" } }, { id: "222", name: "Ohne IG" }] });
    expect(r.pages).toHaveLength(2);
    expect(r.instagram).toEqual([{ id: "1784", name: "@onelog", handle: "onelog", url: "https://www.instagram.com/onelog/", token: "PAGE_TOKEN" }]);
  });
  it("Insights: letzter Tageswert bzw. total_value", () => {
    expect(parseInsightValue({ data: [{ name: "page_media_view", period: "day", values: [{ value: 10 }, { value: 42 }] }] }, "page_media_view")).toBe(42);
    expect(parseInsightValue({ data: [{ name: "views", total_value: { value: 1234 } }] }, "views")).toBe(1234);
    expect(parseInsightValue({ data: [] }, "views")).toBeNull();
  });
  it("Facebook-Beiträge und Instagram-Medien", () => {
    const fb = parseFbPosts({ data: [{ id: "111_1", message: "Hallo", created_time: "2026-10-01T10:00:00+0000", permalink_url: "https://facebook.com/1", shares: { count: 3 }, reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 2 } } }] });
    expect(fb[0].metrics).toEqual({ likes: 12, comments: 2, shares: 3 });
    const ig = parseIgMedia({ data: [{ id: "m1", caption: "Bild", permalink: "https://instagram.com/p/x", timestamp: "2026-10-02T08:00:00+0000", like_count: 40, comments_count: 5 }] });
    expect(ig[0].metrics.likes).toBe(40);
  });
});

describe("X-, TikTok-, YouTube-Parser", () => {
  it("X: Nutzer und Beiträge", () => {
    expect(parseXUser({ data: { id: "42", username: "onelog", public_metrics: { followers_count: 500, tweet_count: 120 } } })).toEqual({ id: "42", username: "onelog", followers: 500, posts: 120 });
    const t = parseXTweets({ data: [{ id: "9", text: "Post", created_at: "2026-10-01T00:00:00.000Z", public_metrics: { retweet_count: 2, reply_count: 1, like_count: 7, quote_count: 1, impression_count: 300 } }] }, "onelog");
    expect(t[0]).toMatchObject({ url: "https://x.com/onelog/status/9", metrics: { impressions: 300, likes: 7, comments: 1, shares: 3 } });
  });
  it("TikTok: Fehler im Body, Nutzer, Videos", () => {
    expect(() => unwrap({ data: {}, error: { code: "access_token_invalid", message: "x" } })).toThrow(ReauthRequiredError);
    expect(parseTtUser({ data: { user: { open_id: "o1", follower_count: 1000, video_count: 12, likes_count: 9000 } }, error: { code: "ok" } })).toMatchObject({ followers: 1000, posts: 12 });
    const v = parseTtVideos({ data: { videos: [{ id: "v1", title: "Clip", create_time: 1759300000, share_url: "https://tiktok.com/v1", view_count: 999, like_count: 50, comment_count: 4, share_count: 2 }] }, error: { code: "ok" } });
    expect(v[0].metrics).toEqual({ views: 999, likes: 50, comments: 4, shares: 2 });
  });
  it("YouTube: verborgene Abonnenten, Videos", () => {
    expect(parseYtChannel({ items: [{ id: "UC1", statistics: { hiddenSubscriberCount: true, viewCount: "10", videoCount: "2" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] })).toMatchObject({ followers: null, views: 10, uploads: "UU1" });
    expect(parseYtVideos({ items: [{ id: "a", snippet: { title: "T" }, statistics: { viewCount: "5" } }] })[0].metrics.views).toBe(5);
  });
});

describe("OAuth-state und Zugangsdaten", () => {
  const base = { p: "linkedin" as const, ws: "w1", u: "u1", a: "a1", slug: "onelog" };
  it("state ist verschlüsselt, an Benutzer/Plattform gebunden und läuft ab", () => {
    const { state, verifier } = createState(base);
    expect(state).not.toContain("u1");
    const st = verifyState(state, { platform: "linkedin", userId: "u1" });
    expect(st.v).toBe(verifier);
    expect(() => verifyState(state, { platform: "linkedin", userId: "anderer" })).toThrow(/anderen Benutzer/);
    expect(() => verifyState(state, { platform: "facebook", userId: "u1" })).toThrow(/Plattform/);
    expect(() => verifyState(state, { platform: "linkedin", userId: "u1" }, Date.now() + 11 * 60_000)).toThrow(/abgelaufen/);
    const tampered = state.slice(0, -3) + (state.endsWith("A") ? "BBB" : "AAA");
    expect(() => verifyState(tampered, { platform: "linkedin", userId: "u1" })).toThrow(/manipuliert|Ungültig/);
  });
  it("PKCE-Challenge ist S256 des Verifiers", () => {
    const { verifier, challenge } = pkcePair();
    expect(challengeFor(verifier)).toBe(challenge);
  });
  it("Zugangsdaten verschlüsselt, Schwärzung", () => {
    const sealed = sealCredentials({ accessToken: "SECRET_TOKEN_123", refreshToken: "R" });
    expect(sealed).not.toContain("SECRET_TOKEN_123");
    expect(openCredentials(sealed)?.accessToken).toBe("SECRET_TOKEN_123");
    expect(openCredentials("kaputt")).toBeNull();
    expect(redact("fehler SECRET_TOKEN_123 access_token=abc", ["SECRET_TOKEN_123"])).toBe("fehler *** access_token=***");
  });
  it("Redirect-URL und Einrichtungshinweis ohne Konfiguration", () => {
    expect(redirectUri("https://crm.example.de/", "linkedin")).toBe("https://crm.example.de/api/channels/oauth/linkedin/callback");
    const info = platformInfo("x", {});
    expect(info.configured).toBe(false);
    expect(info.limits.join(" ")).toMatch(/Pay-per-use/);
    expect(platformInfo("xing", {}).mode).toBe("import");
  });
});

describe("Konto-Auswahl", () => {
  const cands = [
    { id: "1", name: "OneLog GmbH", handle: "onelog" },
    { id: "2", name: "Kompetenzanker", handle: "kompetenzanker" },
  ];
  it("per ID, Handle oder einzigem Kandidaten", () => {
    expect(pickCandidate(cands, { externalId: "2", handle: "x" })?.id).toBe("2");
    expect(pickCandidate(cands, { externalId: null, handle: "@OneLog" })?.id).toBe("1");
    expect(pickCandidate(cands, { externalId: null, handle: "unbekannt" })).toBeNull();
    expect(pickCandidate([cands[0]], { externalId: null, handle: "egal" })?.id).toBe("1");
  });
});

describe("Import von Plattform-Exporten", () => {
  it("Zahlen und Datumsformate", () => {
    expect(parseNumber("1.234")).toBe(1234);
    expect(parseNumber("1,234")).toBe(1234);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("12 %")).toBeCloseTo(0.12);
    expect(parseNumber("–")).toBeNull();
    expect(parseDate("01.10.2026")?.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(parseDate("10/02/2026")?.toISOString().slice(0, 10)).toBe("2026-10-02");
    expect(parseDate("2026-10-03 14:05 +0000")?.toISOString().slice(0, 16)).toBe("2026-10-03T14:05");
  });
  it("LinkedIn-Follower-Export mit Vorzeile → Tageswerte", () => {
    const csv = "Follower-Statistik OneLog\nDate,Organic followers,Total followers\n10/01/2026,3,1200\n10/02/2026,5,1205\n";
    const exp = parseExport(csv);
    expect(exp.kind).toBe("metrics");
    expect(exp.header).toEqual(["Date", "Organic followers", "Total followers"]);
    expect(exp.mapping).toEqual(["date", "skip", "followers"]);
    const rows = toMetricRows(exp.rows, exp.mapping);
    expect(rows.map((r) => r.followers)).toEqual([1200, 1205]);
  });
  it("X-Analytics-Export → Beiträge", () => {
    const csv = 'Tweet id,Tweet permalink,Tweet text,time,impressions,engagements,retweets,replies,likes,url clicks\n123,https://x.com/onelog/status/123,"Hallo, Welt",2026-10-01 10:00 +0000,500,20,2,1,10,4\n';
    const exp = parseExport(csv);
    expect(exp.kind).toBe("posts");
    const posts = toPostRows(exp.rows, exp.mapping);
    expect(posts[0]).toMatchObject({ externalId: "123", url: "https://x.com/onelog/status/123", title: "Hallo, Welt", metrics: { impressions: 500, likes: 10, comments: 1, shares: 2, clicks: 4 } });
  });
  it("Meta-Export mit Semikolon und deutschen Spalten", () => {
    const csv = "Datum;Seiten-Follower;Reichweite\n01.10.2026;1.500;12.000\n";
    const exp = parseExport(csv);
    expect(detectKind(exp.header)).toBe("metrics");
    expect(suggestMapping(exp.header, "metrics")).toEqual(["date", "followers", "views"]);
    expect(toMetricRows(exp.rows, exp.mapping)[0]).toMatchObject({ followers: 1500, views: 12000 });
  });
  it("ohne Datumsspalte verständlicher Fehler", () => {
    expect(() => toMetricRows([["1"]], ["followers"])).toThrow(/Datum/);
  });
});
