-- Patient medical history: structured allergies / chronic conditions /
-- diagnoses. Replaces the free-form `Patient.notes` field for these
-- categories (notes is kept for general doctor remarks).
--
-- All three tables are clinic-scoped (multi-tenant) and ON DELETE CASCADE
-- on patient deletion so DSAR scrubbing keeps working without app-side
-- handling.

CREATE TABLE "PatientAllergy" (
  "id"         TEXT         NOT NULL,
  "clinicId"   TEXT         NOT NULL,
  "patientId"  TEXT         NOT NULL,
  "substance"  TEXT         NOT NULL,
  "reaction"   TEXT,
  "severity"   TEXT         NOT NULL DEFAULT 'MILD',
  "notes"      TEXT,
  "recordedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientAllergy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientAllergy_clinicId_patientId_idx"
  ON "PatientAllergy"("clinicId", "patientId");

ALTER TABLE "PatientAllergy"
  ADD CONSTRAINT "PatientAllergy_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientAllergy"
  ADD CONSTRAINT "PatientAllergy_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PatientChronicCondition" (
  "id"        TEXT         NOT NULL,
  "clinicId"  TEXT         NOT NULL,
  "patientId" TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "sinceDate" TIMESTAMP(3),
  "notes"     TEXT,
  "isActive"  BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientChronicCondition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientChronicCondition_clinicId_patientId_isActive_idx"
  ON "PatientChronicCondition"("clinicId", "patientId", "isActive");

ALTER TABLE "PatientChronicCondition"
  ADD CONSTRAINT "PatientChronicCondition_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientChronicCondition"
  ADD CONSTRAINT "PatientChronicCondition_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PatientDiagnosis" (
  "id"          TEXT         NOT NULL,
  "clinicId"    TEXT         NOT NULL,
  "patientId"   TEXT         NOT NULL,
  "icd10Code"   TEXT,
  "label"       TEXT         NOT NULL,
  "diagnosedAt" TIMESTAMP(3),
  "notes"       TEXT,
  "status"      TEXT         NOT NULL DEFAULT 'ACTIVE',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientDiagnosis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientDiagnosis_clinicId_patientId_status_idx"
  ON "PatientDiagnosis"("clinicId", "patientId", "status");

ALTER TABLE "PatientDiagnosis"
  ADD CONSTRAINT "PatientDiagnosis_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientDiagnosis"
  ADD CONSTRAINT "PatientDiagnosis_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
