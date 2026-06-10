-- Ф6 (TZ-smart-constructor) — мост finalize → Mini App.
-- Idempotent by hand (house rule): safe to re-run.

-- Prescription: bridged rows have no MedicalCase.
ALTER TABLE "Prescription" ALTER COLUMN "caseId" DROP NOT NULL;
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "visitNoteId" TEXT;
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "visitNoteSortOrder" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "Prescription_visitNoteId_visitNoteSortOrder_key"
  ON "Prescription"("visitNoteId", "visitNoteSortOrder");

DO $$ BEGIN
  ALTER TABLE "Prescription"
    ADD CONSTRAINT "Prescription_visitNoteId_fkey"
    FOREIGN KEY ("visitNoteId") REFERENCES "VisitNote"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- VisitNote: follow-up plan + bridge convergence anchor.
ALTER TABLE "VisitNote" ADD COLUMN IF NOT EXISTS "followUpDays" INTEGER;
ALTER TABLE "VisitNote" ADD COLUMN IF NOT EXISTS "followUpNote" TEXT;
ALTER TABLE "VisitNote" ADD COLUMN IF NOT EXISTS "medicationsBridgedAt" TIMESTAMP(3);

-- Clinic: slot → clock mapping for reminder times (null = defaults).
ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "medicationSlotTimes" JSONB;
