-- Der HNSW-Vektorindex wurde versehentlich von 20261006130254_source_content entfernt
-- (prisma migrate dev kennt Indizes auf Unsupported("vector") nicht). Wiederherstellen.
-- Hinweis: Neue Migrationen nur mit ./scripts/new-migration.sh erzeugen – es filtert solche DROPs heraus.
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_hnsw" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);
