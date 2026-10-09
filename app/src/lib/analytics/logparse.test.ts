import { describe, expect, it } from "vitest";
import { isInterestingPath, parseClfDate, parseLogLine } from "./logparse";

describe("parseLogLine", () => {
  it("liest nginx/Apache combined und verwirft die IP", () => {
    const hit = parseLogLine(
      '203.0.113.7 - - [10/Oct/2026:13:55:36 +0200] "GET /preise?x=1 HTTP/1.1" 200 2326 "https://chatgpt.com/" "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"',
    );
    expect(hit).toMatchObject({ method: "GET", path: "/preise?x=1", status: 200, referer: "https://chatgpt.com/" });
    expect(hit?.ua).toContain("GPTBot");
    expect(hit?.ts.toISOString()).toBe("2026-10-10T11:55:36.000Z");
    expect(JSON.stringify(hit)).not.toContain("203.0.113.7");
  });

  it("akzeptiert '-' als leeren Referrer und maskierte Anführungszeichen", () => {
    const hit = parseLogLine('::1 - - [01/Jan/2026:00:00:00 +0000] "GET / HTTP/2.0" 304 0 "-" "Agent \\"X\\""');
    expect(hit?.referer).toBeNull();
    expect(hit?.ua).toBe('Agent "X"');
  });

  it("liest Caddy-JSON", () => {
    const hit = parseLogLine(
      JSON.stringify({
        ts: 1791633336.5,
        status: 200,
        request: { remote_ip: "198.51.100.1", host: "onelog.pro", uri: "/llms.txt", method: "GET", headers: { "User-Agent": ["ClaudeBot/1.0"], Referer: ["https://claude.ai/"] } },
      }),
    );
    expect(hit).toMatchObject({ host: "onelog.pro", path: "/llms.txt", ua: "ClaudeBot/1.0", referer: "https://claude.ai/" });
    expect(JSON.stringify(hit)).not.toContain("198.51.100.1");
  });

  it("ignoriert Unsinn", () => {
    expect(parseLogLine("kaputt")).toBeNull();
    expect(parseLogLine("{kein json")).toBeNull();
    expect(parseLogLine("")).toBeNull();
  });
});

describe("Hilfen", () => {
  it("parseClfDate", () => {
    expect(parseClfDate("31/Dec/2025:23:59:59 -0100")?.toISOString()).toBe("2026-01-01T00:59:59.000Z");
    expect(parseClfDate("99/Foo/2025:00:00:00 +0000")).toBeNull();
  });
  it("isInterestingPath", () => {
    expect(isInterestingPath("/robots.txt")).toBe(true);
    expect(isInterestingPath("/llms.txt")).toBe(true);
    expect(isInterestingPath("/assets/app.js?v=2")).toBe(false);
    expect(isInterestingPath("/_next/static/x")).toBe(false);
  });
});
