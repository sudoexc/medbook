-- P2.1 — Clinical referrals (направления).
--
-- A doctor sends a patient onward: to an internal colleague (toDoctorId, a
-- User) or to an outside clinic/specialty (externalTo, free text). The ICD-10
-- diagnosisCode/diagnosisName are snapshotted from the originating visit so the
-- referral stays truthful even if the note is later re-coded. A REFERRAL
-- Document PDF is rendered async and linked 1:1 via Document.referralId (UNIQUE
-- → the worker upserts idempotently, same anchor as the P1.1 conclusion).
--
-- fromDoctorId/toDoctorId reference User (not Doctor): the mutation gate is
-- "is this the assigned user?", mirroring LabResult.doctorId / Reminder.doctorId.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object) so the migration
-- is safe to re-run — the repo's idempotent-DDL house style.

-- 1. Status enum. Guarded so a re-run can't fail on a pre-existing type.
DO $$
BEGIN
  CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'SCHEDULED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

-- 2. Referral table.
CREATE TABLE IF NOT EXISTS "Referral" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fromDoctorId" TEXT NOT NULL,
    "toDoctorId" TEXT,
    "externalTo" TEXT,
    "visitNoteId" TEXT,
    "reason" TEXT NOT NULL,
    "diagnosisCode" TEXT,
    "diagnosisName" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAppointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- 3. Referral lookup indexes — the two doctor-facing queues (incoming/outgoing)
--    plus a patient-history scan.
CREATE INDEX IF NOT EXISTS "Referral_clinicId_toDoctorId_status_idx" ON "Referral"("clinicId", "toDoctorId", "status");
CREATE INDEX IF NOT EXISTS "Referral_clinicId_fromDoctorId_status_idx" ON "Referral"("clinicId", "fromDoctorId", "status");
CREATE INDEX IF NOT EXISTS "Referral_patientId_idx" ON "Referral"("patientId");

-- 4. Document → Referral 1:1 back-pointer; only auto-generated REFERRAL PDFs
--    set it. UNIQUE is the idempotency anchor for the referral-pdf worker.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "referralId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Document_referralId_key" ON "Document"("referralId");

-- 5. Referral foreign keys. clinic CASCADE (tenant delete); patient/fromDoctor
--    RESTRICT (never orphan a clinical record); toDoctor/visitNote/appointment
--    SET NULL (optional links). Guards make each ADD idempotent.
DO $$
BEGIN
  ALTER TABLE "Referral" ADD CONSTRAINT "Referral_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "Referral" ADD CONSTRAINT "Referral_fromDoctorId_fkey"
    FOREIGN KEY ("fromDoctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "Referral" ADD CONSTRAINT "Referral_toDoctorId_fkey"
    FOREIGN KEY ("toDoctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "Referral" ADD CONSTRAINT "Referral_visitNoteId_fkey"
    FOREIGN KEY ("visitNoteId") REFERENCES "VisitNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "Referral" ADD CONSTRAINT "Referral_scheduledAppointmentId_fkey"
    FOREIGN KEY ("scheduledAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

-- 6. Document → Referral FK. SET NULL: deleting a referral must not cascade
--    away a PDF the patient may already be holding.
DO $$
BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_referralId_fkey"
    FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;
