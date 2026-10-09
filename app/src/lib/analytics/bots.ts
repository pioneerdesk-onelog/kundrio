// Erkennung von Bots (User-Agent) und von Besuchern, die aus KI-Antworten kommen (Referrer/UTM).
// Reine Daten + Funktionen, ohne Abhängigkeiten → auch in Tests und im Log-Import nutzbar.

export type BotCategory = "ai_training" | "ai_search" | "ai_user" | "search" | "seo" | "other";

export const BOT_CATEGORY_LABEL: Record<BotCategory, string> = {
  ai_training: "KI-Training",
  ai_search: "KI-Suche",
  ai_user: "KI im Auftrag eines Menschen",
  search: "Suchmaschine",
  seo: "SEO-Werkzeug",
  other: "Sonstiger Bot",
};

export const AI_BOT_CATEGORIES: BotCategory[] = ["ai_training", "ai_search", "ai_user"];

// Reihenfolge zählt: spezifische Muster vor allgemeinen (z. B. „OAI-SearchBot“ vor „bot“).
// Erweitern: einfach eine Zeile ergänzen. `match` ist ein Teilstring (ohne Groß/Klein) oder RegExp.
type BotRule = { name: string; category: BotCategory; match: string | RegExp };

export const BOT_RULES: BotRule[] = [
  // KI im Auftrag eines Menschen (Live-Abruf während eines Chats)
  { name: "ChatGPT-User", category: "ai_user", match: "chatgpt-user" },
  { name: "Claude-User", category: "ai_user", match: "claude-user" },
  { name: "Perplexity-User", category: "ai_user", match: "perplexity-user" },
  { name: "MistralAI-User", category: "ai_user", match: "mistralai-user" },
  { name: "DuckAssistBot", category: "ai_user", match: "duckassistbot" },
  { name: "Gemini-Deep-Research", category: "ai_user", match: "gemini-deep-research" },
  { name: "Google-NotebookLM", category: "ai_user", match: "google-notebooklm" },
  { name: "Meta-ExternalFetcher", category: "ai_user", match: "meta-externalfetcher" },

  // KI-Suche (Index für Antworten mit Quellen)
  { name: "OAI-SearchBot", category: "ai_search", match: "oai-searchbot" },
  { name: "Claude-SearchBot", category: "ai_search", match: "claude-searchbot" },
  { name: "PerplexityBot", category: "ai_search", match: "perplexitybot" },
  { name: "YouBot", category: "ai_search", match: "youbot" },
  { name: "PhindBot", category: "ai_search", match: "phindbot" },
  { name: "Applebot", category: "search", match: /applebot(?!-extended)/i },

  // KI-Training (Sammeln von Trainingsdaten)
  { name: "GPTBot", category: "ai_training", match: "gptbot" },
  { name: "ClaudeBot", category: "ai_training", match: "claudebot" },
  { name: "anthropic-ai", category: "ai_training", match: "anthropic-ai" },
  { name: "CCBot", category: "ai_training", match: "ccbot" },
  { name: "Bytespider", category: "ai_training", match: "bytespider" },
  { name: "meta-externalagent", category: "ai_training", match: "meta-externalagent" },
  { name: "cohere-ai", category: "ai_training", match: /cohere-(ai|training-data-crawler)/i },
  { name: "Diffbot", category: "ai_training", match: "diffbot" },
  { name: "Amazonbot", category: "ai_training", match: "amazonbot" },
  { name: "Google-CloudVertexBot", category: "ai_training", match: "google-cloudvertexbot" },
  { name: "AI2Bot", category: "ai_training", match: "ai2bot" },
  { name: "Timpibot", category: "ai_training", match: "timpibot" },
  { name: "omgili", category: "ai_training", match: "omgili" },
  { name: "ImagesiftBot", category: "ai_training", match: "imagesiftbot" },
  { name: "PetalBot", category: "ai_training", match: "petalbot" },

  // Klassische Suchmaschinen
  { name: "Googlebot", category: "search", match: /googlebot|google-inspectiontool|storebot-google/i },
  { name: "Bingbot", category: "search", match: /bingbot|bingpreview/i },
  { name: "DuckDuckBot", category: "search", match: "duckduckbot" },
  { name: "YandexBot", category: "search", match: "yandex" },
  { name: "Baiduspider", category: "search", match: "baiduspider" },
  { name: "Qwantbot", category: "search", match: "qwant" },
  { name: "Ecosia", category: "search", match: "ecosiabot" },
  { name: "SeznamBot", category: "search", match: "seznambot" },

  // SEO-Werkzeuge
  { name: "AhrefsBot", category: "seo", match: /ahrefs(bot|siteaudit)/i },
  { name: "SemrushBot", category: "seo", match: "semrush" },
  { name: "MJ12bot", category: "seo", match: "mj12bot" },
  { name: "DotBot", category: "seo", match: "dotbot" },
  { name: "Screaming Frog", category: "seo", match: "screaming frog" },
  { name: "SERankingBot", category: "seo", match: "serankingbacklinksbot" },
  { name: "DataForSeoBot", category: "seo", match: "dataforseobot" },
  { name: "BLEXBot", category: "seo", match: "blexbot" },

  // Allgemeine Muster zuletzt
  { name: "HeadlessChrome", category: "other", match: "headlesschrome" },
  { name: "curl", category: "other", match: /^curl\//i },
  { name: "Wget", category: "other", match: /^wget\//i },
  { name: "python-requests", category: "other", match: /python-requests|python-urllib|aiohttp|httpx/i },
  { name: "Go-http-client", category: "other", match: "go-http-client" },
  { name: "node-fetch", category: "other", match: /node-fetch|axios\/|undici/i },
  { name: "Java", category: "other", match: /^java\//i },
  { name: "Bot (allgemein)", category: "other", match: /bot\b|crawler|spider|scraper|slurp|fetcher|preview/i },
];

export type BotMatch = { category: BotCategory; name: string };

export function classifyUserAgent(ua: string | null | undefined): BotMatch | null {
  const s = (ua ?? "").trim();
  if (!s) return { category: "other", name: "ohne User-Agent" };
  const lower = s.toLowerCase();
  for (const r of BOT_RULES) {
    const hit = typeof r.match === "string" ? lower.includes(r.match) : r.match.test(s);
    if (hit) return { category: r.category, name: r.name };
  }
  return null;
}

export function isAiBot(category: string | null | undefined) {
  return !!category && (AI_BOT_CATEGORIES as string[]).includes(category);
}

// ---------- KI-Referrer ----------

// Host (ohne „www.“) → Name. Subdomains werden mitgeprüft (z. B. „m.perplexity.ai“).
export const AI_REFERRER_HOSTS: Record<string, string> = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "perplexity.ai": "perplexity",
  "claude.ai": "claude",
  "gemini.google.com": "gemini",
  "bard.google.com": "gemini",
  "copilot.microsoft.com": "copilot",
  "copilot.cloud.microsoft": "copilot",
  "chat.mistral.ai": "mistral",
  "meta.ai": "meta",
  "you.com": "you",
  "phind.com": "phind",
  "chat.deepseek.com": "deepseek",
  "grok.com": "grok",
  "poe.com": "poe",
  "duck.ai": "duckai",
  "kagi.com": "kagi",
  "notebooklm.google.com": "notebooklm",
};

// utm_source-Werte, die KI-Dienste setzen (z. B. ChatGPT: utm_source=chatgpt.com)
const AI_UTM: Record<string, string> = {
  "chatgpt.com": "chatgpt",
  chatgpt: "chatgpt",
  openai: "chatgpt",
  "perplexity.ai": "perplexity",
  perplexity: "perplexity",
  "claude.ai": "claude",
  claude: "claude",
  gemini: "gemini",
  "copilot.com": "copilot",
  copilot: "copilot",
  mistral: "mistral",
  deepseek: "deepseek",
};

export const AI_REFERRER_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  mistral: "Le Chat (Mistral)",
  meta: "Meta AI",
  you: "You.com",
  phind: "Phind",
  deepseek: "DeepSeek",
  grok: "Grok",
  poe: "Poe",
  duckai: "Duck.ai",
  kagi: "Kagi",
  notebooklm: "NotebookLM",
};

export function hostOf(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost) return null;
  try {
    const h = urlOrHost.includes("://") ? new URL(urlOrHost).hostname : urlOrHost.split("/")[0];
    const host = h.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return /^[a-z0-9.-]{1,253}$/.test(host) && host.includes(".") ? host : host === "localhost" ? host : null;
  } catch {
    return null;
  }
}

export function aiReferrerFrom(referrerHost: string | null | undefined, utmSource?: string | null): string | null {
  const host = hostOf(referrerHost ?? null);
  if (host) {
    for (const [h, name] of Object.entries(AI_REFERRER_HOSTS)) {
      if (host === h || host.endsWith(`.${h}`)) return name;
    }
  }
  const utm = (utmSource ?? "").trim().toLowerCase();
  if (utm && AI_UTM[utm]) return AI_UTM[utm];
  return null;
}

export function detectDevice(ua: string | null | undefined): "desktop" | "mobile" | "tablet" {
  const s = (ua ?? "").toLowerCase();
  if (s.includes("ipad") || s.includes("tablet") || (s.includes("android") && !s.includes("mobile"))) return "tablet";
  if (s.includes("mobile") || s.includes("iphone") || s.includes("android")) return "mobile";
  return "desktop";
}

export function languageFrom(acceptLanguage: string | null | undefined): string | null {
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return first && /^[a-z]{2}$/.test(first) ? first : null;
}
