-- Clinic request 29.09.2026: a visit may carry one main diagnosis and up to
-- three more. The main one stays in "diagnosisCode" / "diagnosisName"; the
-- others are an ordered JSON array of { code, name } (code null for a
-- diagnosis in the clinic's own words). The default fills every existing
-- note with an empty list, so older conclusions read exactly as before.
-- AlterTable
ALTER TABLE "VisitNote" ADD COLUMN     "additionalDiagnoses" JSONB NOT NULL DEFAULT '[]';
