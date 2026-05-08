-- Phase 19 Wave 4 — SUPER_ADMIN impersonation grants.
--
-- Pairs each `admin_clinic_override` cookie issuance with an audit-grade row:
-- forensic reason, expiresAt clock, optional VIEW_ONLY mode, and an end-state
-- (user_exit | expired | revoked).
--
-- No FK to User/Clinic — the grant must outlive deletion of either party so
-- support/compliance retain the trail (same rationale as ClinicSignupToken).

CREATE TYPE "ImpersonationMode" AS ENUM ('WRITE', 'VIEW_ONLY');

CREATE TABLE "ImpersonationGrant" (
  "id"            TEXT NOT NULL,
  "superAdminId"  TEXT NOT NULL,
  "clinicId"      TEXT NOT NULL,
  "reason"        TEXT NOT NULL,
  "mode"          "ImpersonationMode" NOT NULL DEFAULT 'WRITE',
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "endedAt"       TIMESTAMP(3),
  "endedReason"   TEXT,

  CONSTRAINT "ImpersonationGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImpersonationGrant_superAdminId_startedAt_idx"
  ON "ImpersonationGrant"("superAdminId", "startedAt");

CREATE INDEX "ImpersonationGrant_expiresAt_idx"
  ON "ImpersonationGrant"("expiresAt");
