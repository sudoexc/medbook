-- Audit VW-10: a signed conclusion whose diagnosis is corrected in the 24h
-- window (or re-signed after a revert with another code) left the diagnosis
-- it had created ACTIVE on the patient's card. The row now remembers the
-- note that created it, so the correction can move or resolve it. Nullable:
-- existing rows keep NULL (scripts/backfill-patient-diagnosis-source.ts
-- links the ones a signature created).
-- AlterTable
ALTER TABLE "PatientDiagnosis" ADD COLUMN     "sourceVisitNoteId" TEXT;

-- CreateIndex
CREATE INDEX "PatientDiagnosis_sourceVisitNoteId_idx" ON "PatientDiagnosis"("sourceVisitNoteId");
