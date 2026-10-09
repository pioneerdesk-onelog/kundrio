-- Vektorindex für die semantische Suche (Kosinus)
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_hnsw" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);
-- Volltext/ähnlichkeit für Kontaktsuche
CREATE INDEX IF NOT EXISTS "Contact_search_trgm" ON "Contact" USING gin ((coalesce("firstName",'') || ' ' || coalesce("lastName",'') || ' ' || coalesce("email",'') || ' ' || coalesce("company",'')) gin_trgm_ops);
