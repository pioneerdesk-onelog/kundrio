-- DropIndex
DROP INDEX "KnowledgeChunk_embedding_hnsw";

-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN     "content" TEXT;
