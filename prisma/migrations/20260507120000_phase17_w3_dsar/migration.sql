-- Phase 17 Wave 3 — DSAR (Data Subject Access Requests).
--
-- Two independent lifecycle tables:
--
--   DataExportJob       — patient (or admin on their behalf) asks for a
--                         downloadable copy of every PII-bearing row tied
--                         to the patient. The worker bundles JSON, ZIPs
--                         it (AES-encrypted body) using a generated
--                         passphrase, uploads to MinIO, and delivers the
--                         file via the per-clinic Telegram bot. Only the
--                         passphrase HASH (bcryptjs) is persisted; the
--                         plaintext is shown once.
--
--   DataDeletionJob     — patient asks to delete their account, or admin
--                         schedules one from the CRM. Default mode is
--                         ANONYMIZE (PII scrubbed, aggregates preserved).
--                         HARD_DELETE drops the Patient row entirely.
--                         Hourly cron executes APPROVED jobs whose
--                         scheduledFor has passed; default 90-day delay
--                         gives the patient a cooling-off window.

-- Enums.
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'DELIVERED', 'FAILED', 'EXPIRED');
CREATE TYPE "DataDeletionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'CANCELLED', 'EXECUTED', 'ANONYMIZED');
CREATE TYPE "DataDeletionMode" AS ENUM ('HARD_DELETE', 'ANONYMIZE');

-- DataExportJob.
CREATE TABLE "DataExportJob" (
    "id"                TEXT NOT NULL,
    "clinicId"          TEXT NOT NULL,
    "patientId"         TEXT NOT NULL,
    "status"            "DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "passphraseHash"    TEXT,
    "storageKey"        TEXT,
    "fileSizeBytes"     INTEGER,
    "downloadCount"     INTEGER NOT NULL DEFAULT 0,
    "telegramChatId"    TEXT,
    "expiresAt"         TIMESTAMP(3) NOT NULL,
    "errorMessage"      TEXT,
    "requestedByUserId" TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataExportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataExportJob_clinicId_status_idx"           ON "DataExportJob"("clinicId", "status");
CREATE INDEX "DataExportJob_patientId_createdAt_idx"       ON "DataExportJob"("patientId", "createdAt" DESC);
CREATE INDEX "DataExportJob_expiresAt_idx"                 ON "DataExportJob"("expiresAt");

ALTER TABLE "DataExportJob"
    ADD CONSTRAINT "DataExportJob_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataExportJob"
    ADD CONSTRAINT "DataExportJob_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- DataDeletionJob.
CREATE TABLE "DataDeletionJob" (
    "id"                TEXT NOT NULL,
    "clinicId"          TEXT NOT NULL,
    "patientId"         TEXT NOT NULL,
    "status"            "DataDeletionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "mode"              "DataDeletionMode" NOT NULL DEFAULT 'ANONYMIZE',
    "scheduledFor"      TIMESTAMP(3) NOT NULL,
    "reason"            TEXT,
    "approvedByUserId"  TEXT,
    "approvedAt"        TIMESTAMP(3),
    "executedAt"        TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledAt"       TIMESTAMP(3),
    "cancelReason"      TEXT,
    "notes"             TEXT,
    "requestedByUserId" TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataDeletionJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataDeletionJob_clinicId_status_idx" ON "DataDeletionJob"("clinicId", "status");
CREATE INDEX "DataDeletionJob_scheduledFor_idx"    ON "DataDeletionJob"("scheduledFor");

ALTER TABLE "DataDeletionJob"
    ADD CONSTRAINT "DataDeletionJob_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataDeletionJob"
    ADD CONSTRAINT "DataDeletionJob_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
