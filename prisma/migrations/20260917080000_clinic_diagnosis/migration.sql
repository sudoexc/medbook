-- Clinic-learned diagnosis catalog. Hand-written (migrate dev drifts on this
-- schema — see docs); validated via prisma validate, applied via migrate deploy.
CREATE TABLE "ClinicDiagnosis" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "code" TEXT,
    "nameRu" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClinicDiagnosis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicDiagnosis_clinicId_normalized_key"
    ON "ClinicDiagnosis"("clinicId", "normalized");
CREATE INDEX "ClinicDiagnosis_clinicId_usageCount_idx"
    ON "ClinicDiagnosis"("clinicId", "usageCount");

ALTER TABLE "ClinicDiagnosis"
    ADD CONSTRAINT "ClinicDiagnosis_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClinicDiagnosis"
    ADD CONSTRAINT "ClinicDiagnosis_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
