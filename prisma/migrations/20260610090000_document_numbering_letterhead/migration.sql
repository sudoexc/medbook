-- Smart constructor Ф0 — document numbering + letterhead.
--
-- 1. Clinic gets a printable letterhead image and an optional prefix for
--    human-readable document numbers ("NF-2026-000123"; null → derived from
--    the clinic slug).
-- 2. DocumentCounter holds per-(clinic, year, kind) monotonic counters; the
--    finalize transaction allocates from it atomically.
-- 3. VisitNote.documentNumber is the allocated number (stable from the moment
--    of finalize, so the doctor can print immediately); Document.number is the
--    copy stamped onto the rendered CONCLUSION artifact by the worker.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object) — idempotent
-- DDL house style, survives partially-applied deploys.

ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "letterheadUrl" TEXT;
ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "documentNumberPrefix" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "number" TEXT;
ALTER TABLE "VisitNote" ADD COLUMN IF NOT EXISTS "documentNumber" TEXT;

CREATE TABLE IF NOT EXISTS "DocumentCounter" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentCounter_clinicId_year_kind_key"
  ON "DocumentCounter"("clinicId", "year", "kind");

DO $$
BEGIN
  ALTER TABLE "DocumentCounter"
    ADD CONSTRAINT "DocumentCounter_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;
