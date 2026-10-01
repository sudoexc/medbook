-- Audit PT-07: a DSAR deletion job that keeps failing ends as FAILED with a
-- reason instead of staying APPROVED and retrying forever. Additive and safe
-- on existing rows (attempts starts at 0, errorMessage is null).

-- AlterEnum
ALTER TYPE "DataDeletionStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "DataDeletionJob" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorMessage" TEXT;
