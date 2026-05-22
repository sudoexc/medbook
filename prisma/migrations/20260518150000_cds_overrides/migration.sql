-- G8 — CDS override audit table. One row per CDS warning the doctor
-- chose to keep going past; required before finalizing a visit with
-- unresolved warnings. The snapshot columns (warning_kind, severity,
-- title, detail) decouple historical records from the live rules table.

-- CreateEnum
CREATE TYPE "CdsOverrideReason" AS ENUM (
  'CLINICALLY_JUSTIFIED',
  'PATIENT_INFORMED',
  'ALTERNATIVES_TRIED',
  'FALSE_POSITIVE',
  'OTHER'
);

-- CreateTable
CREATE TABLE "CdsOverride" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "visitNoteId" TEXT,
    "warningKind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "warningTitle" TEXT NOT NULL,
    "warningDetail" TEXT NOT NULL,
    "warningKey" TEXT,
    "reason" "CdsOverrideReason" NOT NULL,
    "reasonNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CdsOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CdsOverride_clinicId_createdAt_idx" ON "CdsOverride"("clinicId", "createdAt");
CREATE INDEX "CdsOverride_clinicId_doctorId_createdAt_idx" ON "CdsOverride"("clinicId", "doctorId", "createdAt");
CREATE INDEX "CdsOverride_clinicId_patientId_createdAt_idx" ON "CdsOverride"("clinicId", "patientId", "createdAt");
CREATE INDEX "CdsOverride_visitNoteId_idx" ON "CdsOverride"("visitNoteId");

-- AddForeignKey
ALTER TABLE "CdsOverride" ADD CONSTRAINT "CdsOverride_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CdsOverride" ADD CONSTRAINT "CdsOverride_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CdsOverride" ADD CONSTRAINT "CdsOverride_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CdsOverride" ADD CONSTRAINT "CdsOverride_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CdsOverride" ADD CONSTRAINT "CdsOverride_visitNoteId_fkey" FOREIGN KEY ("visitNoteId") REFERENCES "VisitNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
