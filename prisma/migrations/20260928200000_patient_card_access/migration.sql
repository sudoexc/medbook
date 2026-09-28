-- Audit G1-09: the access log («кто открывал карточку») must outlive the
-- card. PatientView.patientId becomes a plain id like AuditLog.entityId;
-- deleting a patient used to cascade every view row away.
-- DropForeignKey
ALTER TABLE "PatientView" DROP CONSTRAINT "PatientView_patientId_fkey";

-- Audit PT-11: the doctor's clinical note gets its own row, readable and
-- writable only by clinical roles. It used to share `Patient.notes` with the
-- front desk's staff note. Existing `Patient.notes` text stays where it is
-- (the staff note on the card overview); nothing is moved or lost.
-- CreateTable
CREATE TABLE "PatientClinicalNote" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientClinicalNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientClinicalNote_patientId_key" ON "PatientClinicalNote"("patientId");

-- CreateIndex
CREATE INDEX "PatientClinicalNote_clinicId_idx" ON "PatientClinicalNote"("clinicId");

-- AddForeignKey
ALTER TABLE "PatientClinicalNote" ADD CONSTRAINT "PatientClinicalNote_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientClinicalNote" ADD CONSTRAINT "PatientClinicalNote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
