import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidChallenge, verifyPkce } from "./crypto";
import { matchRedirect, redirectUriProblem, isLoopback } from "./redirect";
import { hasScope, normalizeScopes, sameResource } from "./config";
import { PRESETS } from "../permissions/catalog";
import { intersect, FULL } from "../permissions/catalog";

const pair = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

describe("PKCE S256", () => {
  it("akzeptiert den passenden Verifier", () => {
    const { verifier, challenge } = pair();
    expect(isValidChallenge(challenge)).toBe(true);
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });
  it("lehnt falsche, zu kurze oder fehlende Verifier ab", () => {
    const { challenge } = pair();
    expect(verifyPkce(pair().verifier, challenge)).toBe(false);
    expect(verifyPkce("kurz", challenge)).toBe(false);
    expect(verifyPkce(null, challenge)).toBe(false);
  });
  it("akzeptiert keine plain-Challenges", () => {
    expect(isValidChallenge("abc")).toBe(false);
    expect(isValidChallenge("a".repeat(43) + "=")).toBe(false);
  });
});

describe("Redirect-URIs", () => {
  it("erlaubt nur https und localhost", () => {
    expect(redirectUriProblem("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(redirectUriProblem("http://localhost:33418/callback")).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:5000/cb")).toBeNull();
    expect(redirectUriProblem("http://example.com/cb")).not.toBeNull();
    expect(redirectUriProblem("https://example.com/cb#frag")).not.toBeNull();
    expect(redirectUriProblem("https://user:pw@example.com/cb")).not.toBeNull();
    expect(redirectUriProblem("javascript:alert(1)")).not.toBeNull();
    expect(redirectUriProblem("myapp://callback")).not.toBeNull();
  });
  it("gleicht exakt ab – keine offenen Weiterleitungen", () => {
    const reg = ["https://app.example.com/cb"];
    expect(matchRedirect(reg, "https://app.example.com/cb")).toBe(true);
    expect(matchRedirect(reg, "https://app.example.com/cb/")).toBe(false);
    expect(matchRedirect(reg, "https://app.example.com/cb?x=1")).toBe(false);
    expect(matchRedirect(reg, "https://evil.example.com/cb")).toBe(false);
    expect(matchRedirect(reg, "https://app.example.com.evil.com/cb")).toBe(false);
  });
  it("erlaubt bei Loopback-IP einen anderen Port, sonst nicht", () => {
    expect(matchRedirect(["http://127.0.0.1:1000/callback"], "http://127.0.0.1:55555/callback")).toBe(true);
    expect(matchRedirect(["http://127.0.0.1:1000/callback"], "http://127.0.0.1:55555/other")).toBe(false);
    expect(matchRedirect(["http://localhost:1000/callback"], "http://localhost:2000/callback")).toBe(false);
    expect(matchRedirect(["https://a.example:443/cb"], "https://a.example:8443/cb")).toBe(false);
    expect(isLoopback("http://[::1]:8080/cb")).toBe(true);
  });
});

describe("Scopes und Ressource", () => {
  it("normalisiert Scopes; write impliziert read; unbekannte fallen weg", () => {
    expect(normalizeScopes("mcp:write")).toEqual(["mcp:write", "mcp:read"]);
    expect(normalizeScopes("mcp:read offline_access admin")).toEqual(["mcp:read"]);
    expect(normalizeScopes("")).toEqual([]);
    expect(hasScope(["mcp:write"], "mcp:read")).toBe(true);
    expect(hasScope(["mcp:read"], "mcp:write")).toBe(false);
  });
  it("vergleicht Ressourcen tolerant bei Schreibweise, streng beim Pfad", () => {
    expect(sameResource("HTTPS://CRM.example.de/api/mcp/", "https://crm.example.de/api/mcp")).toBe(true);
    expect(sameResource("https://crm.example.de/api", "https://crm.example.de/api/mcp")).toBe(false);
    expect(sameResource("https://andere.example/api/mcp", "https://crm.example.de/api/mcp")).toBe(false);
    expect(sameResource("https://crm.example.de/api/mcp#x", "https://crm.example.de/api/mcp")).toBe(false);
    expect(sameResource(null, "https://crm.example.de/api/mcp")).toBe(false);
  });
});

describe("Rechte-Schnittmenge OAuth", () => {
  it("ein Token kann nie mehr als der Benutzer", () => {
    const user = PRESETS.vertrieb.permissions;
    const eff = intersect(user, FULL);
    expect(eff.objects.contacts.edit).toBe("own");
    expect(eff.objects.processes.edit).toBe("none");
  });
});
