-- Doctor's per-appointment SOAP note. One row per Appointment (unique
-- appointmentId), created on first edit and finalized when the doctor
-- presses «Завершить приём». Multi-tenant via clinicId; cascade-deleted
-- with the parent clinic or appointment so DSAR scrubbing and routine
-- appointment cleanup don't leak orphan notes.

CREATE TYPE "VisitNoteStatus" AS ENUM ('DRAFT', 'FINALIZED');

CREATE TABLE "VisitNote" (
  "id"              TEXT             NOT NULL,
  "clinicId"        TEXT             NOT NULL,
  "appointmentId"   TEXT             NOT NULL,
  "patientId"       TEXT             NOT NULL,
  "doctorId"        TEXT             NOT NULL,
  "status"          "VisitNoteStatus" NOT NULL DEFAULT 'DRAFT',
  "startedAt"       TIMESTAMP(3),
  "finalizedAt"     TIMESTAMP(3),
  "complaints"      TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "anamnesis"       TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "examination"     TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "prescriptions"   TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "advice"          TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "diagnosisCode"   TEXT,
  "diagnosisName"   TEXT,
  "bodyMarkdown"    TEXT,
  "aiGenerated"     BOOLEAN          NOT NULL DEFAULT false,
  "aiModel"         TEXT,
  "aiTokens"        INTEGER,
  "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "VisitNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitNote_appointmentId_key"
  ON "VisitNote"("appointmentId");

CREATE INDEX "VisitNote_clinicId_doctorId_status_idx"
  ON "VisitNote"("clinicId", "doctorId", "status");

CREATE INDEX "VisitNote_clinicId_patientId_finalizedAt_idx"
  ON "VisitNote"("clinicId", "patientId", "finalizedAt");

ALTER TABLE "VisitNote"
  ADD CONSTRAINT "VisitNote_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitNote"
  ADD CONSTRAINT "VisitNote_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitNote"
  ADD CONSTRAINT "VisitNote_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VisitNote"
  ADD CONSTRAINT "VisitNote_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
