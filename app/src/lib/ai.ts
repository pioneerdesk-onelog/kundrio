import "server-only";
import { db } from "./db";
import { env } from "./env";
import { chatDetailed, embedDetailed, type ChatMessage, type Usage } from "./ollama";

// KI-Aufrufe mit Protokoll (AiUsageLog): Zweck, Modell, Dauer. Inhalte werden NICHT gespeichert.
// Neue Funktionen sollen diese Wrapper statt ollama.ts direkt nutzen.

async function log(workspaceId: string | null, purpose: string, model: string, started: number, usage: Usage = {}) {
  try {
    await db.aiUsageLog.create({
      data: { workspaceId, purpose, model, ms: Date.now() - started, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut },
    });
  } catch {
    // Protokollfehler dürfen den eigentlichen Aufruf nie blockieren
  }
}

export async function aiChat(workspaceId: string | null, purpose: string, messages: ChatMessage[], opts: { temperature?: number } = {}) {
  const started = Date.now();
  const out = await chatDetailed(messages, opts);
  await log(workspaceId, purpose, env.chatModel(), started, out);
  return out.content;
}

export async function aiEmbed(workspaceId: string | null, purpose: string, texts: string[]) {
  const started = Date.now();
  const out = await embedDetailed(texts);
  await log(workspaceId, purpose, env.embedModel(), started, out);
  return out.embeddings;
}
