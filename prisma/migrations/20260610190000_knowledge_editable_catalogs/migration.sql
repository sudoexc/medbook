-- Ф4 (TZ-smart-constructor) — editable knowledge catalogs.
-- Clinic-local rows for Drug + HandoutTemplate (DiagnosisGuide already has
-- clinicId since Ф1, ClinicalProtocol since Ф3) and the UZ handout body.

ALTER TABLE "Drug" ADD COLUMN "clinicId" TEXT;

ALTER TABLE "HandoutTemplate" ADD COLUMN "bodyMdUz" TEXT;
ALTER TABLE "HandoutTemplate" ADD COLUMN "clinicId" TEXT;

CREATE INDEX "Drug_clinicId_active_idx" ON "Drug"("clinicId", "active");
CREATE INDEX "HandoutTemplate_clinicId_active_idx" ON "HandoutTemplate"("clinicId", "active");
