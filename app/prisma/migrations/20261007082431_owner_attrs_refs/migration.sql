-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "attributes" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN     "externalRef" TEXT;

-- AlterTable
ALTER TABLE "Stage" ADD COLUMN     "externalRef" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Task_ownerId_doneAt_idx" ON "Task"("ownerId", "doneAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
