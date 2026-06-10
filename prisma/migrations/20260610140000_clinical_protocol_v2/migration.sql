-- Ф3 (TZ-smart-constructor) — ClinicalProtocol v2: ownership scopes
-- (global / clinic / doctor-personal), structured prescription items,
-- guide link, follow-up interval.
-- Idempotent: IF NOT EXISTS everywhere (house rule).

ALTER TABLE "ClinicalProtocol" ADD COLUMN IF NOT EXISTS "clinicId" TEXT;
ALTER TABLE "ClinicalProtocol" ADD COLUMN IF NOT EXISTS "doctorId" TEXT;
ALTER TABLE "ClinicalProtocol" ADD COLUMN IF NOT EXISTS "prescriptionItems" JSONB;
ALTER TABLE "ClinicalProtocol" ADD COLUMN IF NOT EXISTS "guideCode" TEXT;
ALTER TABLE "ClinicalProtocol" ADD COLUMN IF NOT EXISTS "followUpDays" INTEGER;

CREATE INDEX IF NOT EXISTS "ClinicalProtocol_clinicId_active_idx"
    ON "ClinicalProtocol"("clinicId", "active");
CREATE INDEX IF NOT EXISTS "ClinicalProtocol_doctorId_active_idx"
    ON "ClinicalProtocol"("doctorId", "active");
