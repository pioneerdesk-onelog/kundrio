import { describe, expect, it, beforeAll } from "vitest";
import { createHash } from "node:crypto";

beforeAll(() => {
  process.env.APP_SECRET = process.env.APP_SECRET || "y".repeat(40);
  process.env.GOOGLE_CLIENT_ID = "gid";
  process.env.MS_CLIENT_ID = "mid";
  process.env.APP_URL = "https://crm.example.com";
});

describe("OAuth-state und PKCE", async () => {
  const { makeState, readState, pkcePair, authorizeUrl } = await import("./oauth");
  it("PKCE: challenge = base64url(sha256(verifier))", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });
  it("state ist an Benutzer + Anbieter gebunden und läuft ab", () => {
    const now = 1_800_000_000_000;
    const s = makeState("u1", "google", "ver", "/sa/x/kalender", now);
    expect(readState(s, "u1", "google", now + 1000).v).toBe("ver");
    expect(() => readState(s, "u2", "google", now)).toThrow(/anderen Benutzer/);
    expect(() => readState(s, "u1", "microsoft", now)).toThrow(/Anbieter/);
    expect(() => readState(s, "u1", "google", now + 11 * 60_000)).toThrow(/abgelaufen/);
    expect(() => readState(s.slice(0, -4) + "AAAA", "u1", "google", now)).toThrow(/manipuliert/);
  });
  it("Rücksprung nur auf interne Pfade", () => {
    const now = Date.now();
    expect(readState(makeState("u1", "google", "v", "https://evil.example", now), "u1", "google", now).r).toBe("/konto/kalender");
    expect(readState(makeState("u1", "google", "v", "//evil.example", now), "u1", "google", now).r).toBe("/konto/kalender");
  });
  it("Autorisierungs-URLs enthalten Offline-Zugriff, PKCE S256 und Redirect", () => {
    const g = new URL(authorizeUrl("google", "st", "ch"));
    expect(g.searchParams.get("access_type")).toBe("offline");
    expect(g.searchParams.get("code_challenge_method")).toBe("S256");
    expect(g.searchParams.get("redirect_uri")).toBe("https://crm.example.com/api/calendar/oauth/google/callback");
    expect(g.searchParams.get("scope")).toContain("calendar.events");
    const m = new URL(authorizeUrl("microsoft", "st", "ch"));
    expect(m.pathname).toContain("/organizations/oauth2/v2.0/authorize");
    expect(m.searchParams.get("scope")).toContain("offline_access");
    expect(m.searchParams.get("scope")).toContain("Calendars.ReadWrite");
  });
});
