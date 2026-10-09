import { describe, expect, it } from "vitest";
import { aiReferrerFrom, classifyUserAgent, detectDevice, hostOf, languageFrom } from "./bots";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

describe("classifyUserAgent", () => {
  it("erkennt normale Browser nicht als Bot", () => {
    expect(classifyUserAgent(CHROME)).toBeNull();
    expect(classifyUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")).toBeNull();
  });

  it.each([
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)", "ai_training", "GPTBot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "ai_training", "ClaudeBot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot", "ai_search", "OAI-SearchBot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "ai_user", "ChatGPT-User"],
    ["Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)", "ai_user", "Claude-User"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", "ai_search", "PerplexityBot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)", "ai_user", "Perplexity-User"],
    ["CCBot/2.0 (https://commoncrawl.org/faq/)", "ai_training", "CCBot"],
    ["meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)", "ai_training", "meta-externalagent"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "search", "Googlebot"],
    ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "search", "Bingbot"],
    ["Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)", "seo", "AhrefsBot"],
    ["curl/8.7.1", "other", "curl"],
    ["python-requests/2.32.3", "other", "python-requests"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36", "other", "HeadlessChrome"],
    ["SomeNewCrawler/1.0", "other", "Bot (allgemein)"],
  ])("%s", (ua, category, name) => {
    expect(classifyUserAgent(ua)).toEqual({ category, name });
  });

  it("wertet fehlenden User-Agent als Bot", () => {
    expect(classifyUserAgent("")?.category).toBe("other");
  });
});

describe("aiReferrerFrom", () => {
  it("erkennt KI-Hosts inkl. Subdomains", () => {
    expect(aiReferrerFrom("https://chatgpt.com/")).toBe("chatgpt");
    expect(aiReferrerFrom("www.perplexity.ai")).toBe("perplexity");
    expect(aiReferrerFrom("https://gemini.google.com/app")).toBe("gemini");
  });
  it("erkennt utm_source", () => {
    expect(aiReferrerFrom(null, "chatgpt.com")).toBe("chatgpt");
  });
  it("ignoriert normale Quellen", () => {
    expect(aiReferrerFrom("https://www.google.com/")).toBeNull();
    expect(aiReferrerFrom("notchatgpt.com")).toBeNull();
  });
});

describe("Hilfsfunktionen", () => {
  it("hostOf", () => {
    expect(hostOf("https://www.Example.com/a?b")).toBe("example.com");
    expect(hostOf("kaputt::")).toBeNull();
  });
  it("detectDevice", () => {
    expect(detectDevice(CHROME)).toBe("desktop");
    expect(detectDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe("tablet");
    expect(detectDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari")).toBe("mobile");
  });
  it("languageFrom", () => {
    expect(languageFrom("de-DE,de;q=0.9,en;q=0.8")).toBe("de");
    expect(languageFrom("")).toBeNull();
  });
});
