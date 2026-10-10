-- «Постоянно» (doctor's request 10.10.2026): a prescription taken with no
-- end, for life (blood pressure, epilepsy). Additive only: a NOT NULL column
-- with a constant default is a metadata-only change on PostgreSQL 11+.
-- AlterTable
ALTER TABLE "VisitPrescription" ADD COLUMN "ongoing" BOOLEAN NOT NULL DEFAULT false;

-- A lifelong course has no day count. The API normalizes (ongoing wins and
-- durationDays is cleared); this guards the invariant at the database.
ALTER TABLE "VisitPrescription" ADD CONSTRAINT "VisitPrescription_ongoing_no_days"
  CHECK (NOT "ongoing" OR "durationDays" IS NULL);
