-- AlterTable
ALTER TABLE "User" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "agencyRole" TEXT NOT NULL DEFAULT 'member';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "fourEyes" BOOLEAN NOT NULL DEFAULT false;
