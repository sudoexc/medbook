-- Audit CD-09 (review): a signed consent or contract is never deleted, so a
-- misfiled one is voided by ADMIN with a reason instead. Nullable: every
-- existing row stays as it is (not voided).

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;
