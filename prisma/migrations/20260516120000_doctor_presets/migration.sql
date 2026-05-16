-- Per-doctor reusable presets for the reception ChipFieldCard.
-- One row = one chip; clicking it pushes `fieldValue` into the matching
-- structured array on VisitNote AND appends `noteTemplate` to bodyMarkdown.

-- CreateEnum
CREATE TYPE "DoctorPresetField" AS ENUM ('COMPLAINTS', 'ANAMNESIS', 'EXAMINATION', 'PRESCRIPTIONS', 'ADVICE');

-- CreateTable
CREATE TABLE "DoctorPreset" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "field" "DoctorPresetField" NOT NULL,
    "label" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
    "noteTemplate" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctorPreset_clinicId_doctorId_field_active_sortOrder_idx" ON "DoctorPreset"("clinicId", "doctorId", "field", "active", "sortOrder");

-- AddForeignKey
ALTER TABLE "DoctorPreset" ADD CONSTRAINT "DoctorPreset_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorPreset" ADD CONSTRAINT "DoctorPreset_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
