-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "buyerEmail" TEXT,
ADD COLUMN     "serviceFrom" DATE,
ADD COLUMN     "serviceTo" DATE,
ADD COLUMN     "taxExemptionReason" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "agentApiEnabled" BOOLEAN NOT NULL DEFAULT true;


-- Bisheriges Verhalten beibehalten: URL- und Wiki-Quellen waren für Agenten sichtbar
UPDATE "KnowledgeSource" SET "isPublic" = true WHERE "kind" IN ('url', 'wiki');
