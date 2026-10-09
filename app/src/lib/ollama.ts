import { env } from "./env";

// Standard: Ollama lokal, es verlassen keine Daten den Rechner. Im Betrieb auf STACKIT: AI_PROVIDER=openai
// spricht einen OpenAI-kompatiblen Dienst an (STACKIT AI Model Serving, EU01) mit AI_BASE_URL + AI_API_KEY.

// Zeitlimits (LR-5): Ohne eigenes Limit hingen Anfragen an ein nicht antwortendes Ollama bis zu 300 s
// (undici-Standard) – öffentliche Agent-API und Worker-Warteschlange blockierten so lange.
const ms = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const embedTimeoutMs = () => ms("OLLAMA_EMBED_TIMEOUT_MS", 30_000);
const chatTimeoutMs = () => ms("OLLAMA_CHAT_TIMEOUT_MS", 240_000);

const openai = () => env.aiProvider() === "openai";
const label = () => (openai() ? "KI-Dienst" : "Ollama");

async function ollamaFetch(path: string, body: unknown, timeoutMs: number) {
  const base = openai() ? env.aiBaseUrl().replace(/\/+$/, "") : env.ollamaUrl();
  try {
    return await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(openai() ? { authorization: `Bearer ${env.aiApiKey()}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(`${label()} antwortet nicht (Zeitlimit ${Math.round(timeoutMs / 1000)} s) – KI ist vorübergehend nicht verfügbar.`);
    }
    throw new Error(`${label()} nicht erreichbar: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)}`);
  }
}

export type Usage = { tokensIn?: number; tokensOut?: number };

export async function embed(texts: string[]): Promise<number[][]> {
  return (await embedDetailed(texts)).embeddings;
}

export async function embedDetailed(texts: string[]): Promise<{ embeddings: number[][] } & Usage> {
  if (texts.length === 0) return { embeddings: [] };
  if (openai()) {
    const r = await ollamaFetch("/embeddings", { model: env.embedModel(), input: texts, dimensions: env.embedDim() }, embedTimeoutMs());
    if (!r.ok) throw new Error(`KI-Dienst embed fehlgeschlagen: ${r.status} ${await r.text()}`);
    const d = (await r.json()) as { data: { index: number; embedding: number[] }[]; usage?: { prompt_tokens?: number } };
    const embeddings = [...d.data].sort((a, b) => a.index - b.index).map((x) => x.embedding);
    checkDims(embeddings);
    return { embeddings, tokensIn: d.usage?.prompt_tokens };
  }
  const res = await ollamaFetch("/api/embed", { model: env.embedModel(), input: texts }, embedTimeoutMs());
  if (!res.ok) throw new Error(`Ollama embed fehlgeschlagen: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { embeddings: number[][]; prompt_eval_count?: number };
  checkDims(data.embeddings);
  return { embeddings: data.embeddings, tokensIn: data.prompt_eval_count };
}

function checkDims(embeddings: number[][]) {
  const dim = env.embedDim();
  for (const e of embeddings) {
    if (e.length !== dim) throw new Error(`Embedding-Dimension ${e.length} ≠ EMBED_DIM ${dim}. Reindex nötig?`);
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function chat(messages: ChatMessage[], opts: { model?: string; temperature?: number } = {}): Promise<string> {
  return (await chatDetailed(messages, opts)).content;
}

export async function chatDetailed(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number } = {},
): Promise<{ content: string } & Usage> {
  if (openai()) {
    const r = await ollamaFetch(
      "/chat/completions",
      // wie think:false bei Ollama: kein verborgener Denkteil (spart Tokens und Zeit)
      { model: opts.model ?? env.chatModel(), messages, stream: false, temperature: opts.temperature ?? 0.2, chat_template_kwargs: { enable_thinking: false } },
      chatTimeoutMs(),
    );
    if (!r.ok) throw new Error(`KI-Dienst chat fehlgeschlagen: ${r.status} ${await r.text()}`);
    const d = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = d.choices?.[0]?.message?.content;
    if (!text) throw new Error("KI-Dienst lieferte keine Antwort");
    return { content: stripThink(text), tokensIn: d.usage?.prompt_tokens, tokensOut: d.usage?.completion_tokens };
  }
  const res = await ollamaFetch(
    "/api/chat",
    { model: opts.model ?? env.chatModel(), messages, stream: false, think: false, options: { temperature: opts.temperature ?? 0.2 } },
    chatTimeoutMs(),
  );
  if (!res.ok) throw new Error(`Ollama chat fehlgeschlagen: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
  const content = data.message?.content;
  if (!content) throw new Error("Ollama lieferte keine Antwort");
  return {
    content: stripThink(content),
    tokensIn: data.prompt_eval_count,
    tokensOut: data.eval_count,
  };
}

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
}
