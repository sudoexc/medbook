-- Audit CD-06: who put a document in the chart, stated explicitly instead of
-- being guessed from `uploadedById IS NULL` (the workers write null too).

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('STAFF', 'PATIENT', 'SYSTEM');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "source" "DocumentSource" NOT NULL DEFAULT 'STAFF';

-- Backfill. Rendered from a visit note or a referral: the system. A
-- conclusion, or any row carrying a QR verify token (only the workers mint
-- one), stays the system's even if its source record was deleted since
-- (both links are ON DELETE SET NULL).
UPDATE "Document"
SET "source" = 'SYSTEM'
WHERE "visitNoteId" IS NOT NULL
   OR "referralId" IS NOT NULL
   OR "type" = 'CONCLUSION'
   OR "verifyToken" IS NOT NULL;

-- No staff uploader and nothing rendered behind it: the Mini App upload
-- (the same rule the upload quota uses to count a patient's files).
UPDATE "Document"
SET "source" = 'PATIENT'
WHERE "uploadedById" IS NULL
  AND "source" = 'STAFF'
  AND "visitNoteId" IS NULL
  AND "referralId" IS NULL;
