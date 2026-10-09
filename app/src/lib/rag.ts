import "server-only";
import { createHash } from "node:crypto";
import { db } from "./db";
import { chunkText } from "./chunk";
import { toVectorLiteral } from "./ollama";
import { aiChat, aiEmbed } from "./ai";
import { env } from "./env";

// RAG im CRM: Wissen pro Sub-Account (Workspace), strikt getrennt.

export async function indexSource(sourceId: string, text: string) {
  const source = await db.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId } });
  const hash = createHash("sha256").update(text).digest("hex");
  try {
    const parts = chunkText(text);
    const vectors: number[][] = [];
    for (let i = 0; i < parts.length; i += 16) vectors.push(...(await aiEmbed(source.workspaceId, "rag-index", parts.slice(i, i + 16))));

    await db.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({ where: { sourceId } });
      for (let i = 0; i < parts.length; i++) {
        await tx.$executeRaw`
          INSERT INTO "KnowledgeChunk" ("id","workspaceId","sourceId","position","content","embedding","embedModel","createdAt")
          VALUES (${crypto.randomUUID()}, ${source.workspaceId}, ${sourceId}, ${i}, ${parts[i]},
                  ${toVectorLiteral(vectors[i])}::vector, ${env.embedModel()}, now())`;
      }
      await tx.knowledgeSource.update({
        where: { id: sourceId },
        data: { status: "indexed", error: null, contentHash: hash },
      });
    }, { timeout: 60_000 });
    return { chunks: parts.length };
  } catch (err) {
    // Fehler sichtbar machen, nicht als Erfolg verbuchen
    await db.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: "failed", error: String(err instanceof Error ? err.message : err).slice(0, 500) },
    });
    throw err;
  }
}

export type Hit = { id: string; sourceId: string; title: string; content: string; score: number };

export async function search(workspaceId: string, query: string, k = 6): Promise<Hit[]> {
  // qwen3-embedding: Anfragen mit Instruktion, Dokumente ohne
  const [vec] = await aiEmbed(workspaceId, "rag-search", [`Instruct: Finde Abschnitte, die die Frage beantworten\nQuery: ${query}`]);
  return db.$queryRaw<Hit[]>`
    SELECT c."id", c."sourceId", s."title", c."content",
           1 - (c."embedding" <=> ${toVectorLiteral(vec)}::vector) AS score
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
    WHERE c."workspaceId" = ${workspaceId} AND c."embedModel" = ${env.embedModel()}
    ORDER BY c."embedding" <=> ${toVectorLiteral(vec)}::vector
    LIMIT ${k}`;
}

export async function answer(workspaceId: string, question: string) {
  const hits = await search(workspaceId, question);
  if (hits.length === 0) {
    return { answer: "Dazu gibt es in diesem Sub-Account noch kein Wissen.", hits };
  }
  const context = hits.map((h, i) => `[${i + 1}] (${h.title})\n${h.content}`).join("\n\n---\n\n");
  const text = await aiChat(workspaceId, "rag-answer", [
    {
      role: "system",
      content:
        "Du beantwortest Fragen ausschließlich auf Basis der Quellen. Antworte auf Deutsch, knapp. " +
        "Belege jede Aussage mit [n]. Wenn die Quellen die Frage nicht beantworten, sag das klar.",
    },
    { role: "user", content: `Quellen:\n\n${context}\n\nFrage: ${question}` },
  ]);
  return { answer: text, hits };
}
