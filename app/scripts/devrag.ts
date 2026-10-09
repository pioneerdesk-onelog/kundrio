// Dev-RAG: semantische Suche über Wiki, Doku und Code dieses Projekts.
// Speichert in Postgres-Schema "devrag" (getrennt von den CRM-Daten), Embeddings lokal über Ollama.
//
//   npm run rag:index            – geänderte Dateien (neu) indizieren
//   npm run rag -- "Frage"       – Treffer anzeigen
//   npm run rag -- --answer "…"  – Treffer + Antwort des lokalen Modells
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { chunkText } from "../src/lib/chunk";
import { chat, embed, toVectorLiteral } from "../src/lib/ollama";
import { env } from "../src/lib/env";

const ROOT = path.resolve(__dirname, "../..");
const INCLUDE_DIRS = ["wiki", "raw", "docs", "app/src", "app/prisma", "app/scripts"];
const INCLUDE_FILES = ["CLAUDE.md", "README.md", "docker-compose.yml"];
const EXT = new Set([".md", ".ts", ".tsx", ".prisma", ".sql", ".yml", ".yaml", ".json"]);
const SKIP = /(^|\/)(node_modules|\.next|\.git|migrations\/migration_lock)|\.env/;
const MAX_BYTES = 300_000;

const db = new PrismaClient();

async function ensureSchema() {
  await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS devrag`);
  await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS devrag.chunk (
      id bigserial PRIMARY KEY,
      path text NOT NULL,
      file_hash text NOT NULL,
      position int NOT NULL,
      content text NOT NULL,
      embed_model text NOT NULL,
      embedding vector(${env.embedDim()}) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS chunk_path ON devrag.chunk(path)`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS chunk_hnsw ON devrag.chunk USING hnsw (embedding vector_cosine_ops)`);
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full);
    if (SKIP.test(rel)) continue;
    if (e.isDirectory()) yield* walk(full);
    else if (EXT.has(path.extname(e.name))) yield full;
  }
}

async function collectFiles() {
  const files: string[] = [];
  for (const d of INCLUDE_DIRS) for await (const f of walk(path.join(ROOT, d))) files.push(f);
  for (const f of INCLUDE_FILES) {
    const full = path.join(ROOT, f);
    if (await stat(full).then(() => true, () => false)) files.push(full);
  }
  return files;
}

async function index() {
  await ensureSchema();
  const files = await collectFiles();
  const known = new Map(
    (await db.$queryRawUnsafe<{ path: string; file_hash: string; embed_model: string }[]>(
      `SELECT DISTINCT path, file_hash, embed_model FROM devrag.chunk`,
    )).map((r) => [r.path, r]),
  );
  const seen = new Set<string>();
  let changed = 0;

  for (const full of files) {
    const rel = path.relative(ROOT, full);
    seen.add(rel);
    const buf = await readFile(full);
    if (buf.length > MAX_BYTES) continue;
    const text = buf.toString("utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    const prev = known.get(rel);
    if (prev && prev.file_hash === hash && prev.embed_model === env.embedModel()) continue;

    // Dateipfad voranstellen, damit Treffer ihren Kontext tragen
    const parts = chunkText(text, 1500, 150).map((c) => `Datei: ${rel}\n\n${c}`);
    const vectors: number[][] = [];
    for (let i = 0; i < parts.length; i += 16) vectors.push(...(await embed(parts.slice(i, i + 16))));
    await db.$transaction([
      db.$executeRaw`DELETE FROM devrag.chunk WHERE path = ${rel}`,
      ...parts.map((p, i) =>
        db.$executeRaw`INSERT INTO devrag.chunk (path, file_hash, position, content, embed_model, embedding)
          VALUES (${rel}, ${hash}, ${i}, ${p}, ${env.embedModel()}, ${toVectorLiteral(vectors[i])}::vector)`,
      ),
    ]);
    changed++;
    console.log(`indiziert: ${rel} (${parts.length})`);
  }

  // Gelöschte Dateien entfernen
  for (const p of known.keys()) if (!seen.has(p)) await db.$executeRaw`DELETE FROM devrag.chunk WHERE path = ${p}`;
  console.log(`${changed} Datei(en) aktualisiert, ${files.length} geprüft.`);
}

async function query(q: string, withAnswer: boolean) {
  // qwen3-embedding: Anfragen mit Instruktion, Dokumente ohne
  const [vec] = await embed([`Instruct: Finde Abschnitte aus Projektdoku und Code, die die Frage beantworten\nQuery: ${q}`]);
  const hits = await db.$queryRaw<{ path: string; content: string; score: number }[]>`
    SELECT path, content, 1 - (embedding <=> ${toVectorLiteral(vec)}::vector) AS score
    FROM devrag.chunk WHERE embed_model = ${env.embedModel()}
    ORDER BY embedding <=> ${toVectorLiteral(vec)}::vector LIMIT 8`;
  for (const h of hits) console.log(`\n── ${h.path}  (${Number(h.score).toFixed(3)})\n${h.content.slice(0, 600)}`);
  if (withAnswer && hits.length) {
    const ctx = hits.map((h, i) => `[${i + 1}] ${h.content}`).join("\n\n---\n\n");
    const a = await chat([
      { role: "system", content: "Beantworte die Frage nur anhand der Quellen, auf Deutsch, mit Belegen [n] und Dateipfaden. Sag klar, wenn die Quellen nicht reichen." },
      { role: "user", content: `Quellen:\n\n${ctx}\n\nFrage: ${q}` },
    ]);
    console.log(`\n══ Antwort ══\n${a}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "index") return index();
  const withAnswer = args[0] === "--answer";
  const q = (withAnswer ? args.slice(1) : args).join(" ").trim();
  if (!q) throw new Error('Aufruf: npm run rag -- "Frage"  oder  npm run rag:index');
  return query(q, withAnswer);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
