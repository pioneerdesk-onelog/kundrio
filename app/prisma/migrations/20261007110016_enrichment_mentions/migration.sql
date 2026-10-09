-- DropIndex

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "enrichedAt" TIMESTAMP(3),
ADD COLUMN     "managingDirectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "profile" JSONB,
ADD COLUMN     "registerCourt" TEXT,
ADD COLUMN     "registerNumber" TEXT,
ADD COLUMN     "socialLinks" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "vatId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "enrichedAt" TIMESTAMP(3),
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "socialLinks" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "enrichPersons" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mentionMonitoring" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EnrichmentSuggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sourceUrl" TEXT,
    "sourceKind" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceHost" TEXT,
    "sourceKind" TEXT NOT NULL,
    "language" TEXT,
    "publishedAt" TIMESTAMP(3),
    "snippet" TEXT,
    "summary" TEXT,
    "sentiment" TEXT,
    "relevance" DOUBLE PRECISION,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrichmentSuggestion_workspaceId_objectType_objectId_status_idx" ON "EnrichmentSuggestion"("workspaceId", "objectType", "objectId", "status");

-- CreateIndex
CREATE INDEX "Mention_workspaceId_companyId_publishedAt_idx" ON "Mention"("workspaceId", "companyId", "publishedAt");

-- CreateIndex
CREATE INDEX "Mention_workspaceId_contactId_publishedAt_idx" ON "Mention"("workspaceId", "contactId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mention_workspaceId_url_companyId_key" ON "Mention"("workspaceId", "url", "companyId");

-- AddForeignKey
ALTER TABLE "EnrichmentSuggestion" ADD CONSTRAINT "EnrichmentSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
