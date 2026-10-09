// Zentrale Konfiguration. Werte kommen aus .env (siehe .env.example).
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Umgebungsvariable ${name} fehlt`);
  return v;
}

export const env = {
  ollamaUrl: () => req("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
  // "ollama" (Standard) oder "openai" = OpenAI-kompatibler Dienst, z. B. STACKIT AI Model Serving
  aiProvider: () => (process.env.AI_PROVIDER === "openai" ? "openai" : "ollama") as "ollama" | "openai",
  aiBaseUrl: () => req("AI_BASE_URL"),
  aiApiKey: () => req("AI_API_KEY"),
  embedModel: () => req("OLLAMA_EMBED_MODEL", "qwen3-embedding:0.6b"),
  embedDim: () => Number(req("EMBED_DIM", "1024")),
  chatModel: () => req("OLLAMA_CHAT_MODEL", "qwen3.6:35b-a3b"),
  smtpHost: () => req("SMTP_HOST", "127.0.0.1"),
  smtpPort: () => Number(req("SMTP_PORT", "51025")),
  smtpSecure: () => process.env.SMTP_SECURE === "true",
  smtpUser: () => process.env.SMTP_USER || undefined,
  smtpPass: () => process.env.SMTP_PASS || undefined,
  mailMode: () => (process.env.MAIL_MODE === "live" ? "live" : "capture") as "live" | "capture",
  appSecret: () => req("APP_SECRET"),
  appUrl: () => req("APP_URL", "http://127.0.0.1:3100"),
};

/**
 * Prüft beim Start in Produktion, ob alle Pflichtwerte sicher gesetzt sind.
 * Wirft mit einer verständlichen Liste aller Probleme (ohne Werte auszugeben).
 */
export function validateProductionEnv(e: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  // Lokaler Produktions-Build (nur Loopback, z. B. Abnahmetest): http und fehlender Proxy sind dort zulässig
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(e.APP_URL ?? "");
  if (!e.DATABASE_URL) problems.push("DATABASE_URL fehlt");
  if (!e.APP_SECRET || e.APP_SECRET.length < 32) problems.push("APP_SECRET fehlt oder ist kürzer als 32 Zeichen");
  if (e.APP_SECRET && /bitte-ersetzen|changeme|secret/i.test(e.APP_SECRET)) problems.push("APP_SECRET ist ein Platzhalter");
  if (!local && !e.APP_URL?.startsWith("https://")) problems.push("APP_URL muss mit https:// beginnen");
  if (!e.MAIL_EVENTS_SECRET || e.MAIL_EVENTS_SECRET.length < 24) problems.push("MAIL_EVENTS_SECRET fehlt oder ist kürzer als 24 Zeichen");
  if (e.MAIL_MODE === "live" && !e.SMTP_HOST) problems.push("MAIL_MODE=live ohne SMTP_HOST");
  if (!local && e.WEBHOOK_ALLOW_PRIVATE === "true") problems.push("WEBHOOK_ALLOW_PRIVATE=true ist in Produktion nicht erlaubt");
  if (!local && (e.TRUST_PROXY === undefined || e.TRUST_PROXY === "")) problems.push("TRUST_PROXY nicht gesetzt (hinter Caddy/Ingress: 1)");
  if (e.AI_PROVIDER === "openai") {
    if (!e.AI_BASE_URL?.startsWith("https://")) problems.push("AI_PROVIDER=openai braucht AI_BASE_URL mit https://");
    if (!e.AI_API_KEY) problems.push("AI_PROVIDER=openai ohne AI_API_KEY");
  }
  return problems;
}

export function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production" || process.env.SKIP_ENV_CHECK === "1") return;
  const problems = validateProductionEnv();
  if (problems.length) {
    throw new Error(`Konfiguration unvollständig – Start abgebrochen:\n- ${problems.join("\n- ")}`);
  }
}
