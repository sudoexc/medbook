-- Phase 17 Wave 1 — Compliance & Trust foundation.
--
-- Schema deltas:
--   Patient.marketingOptOut + supporting metadata — explicit opt-OUT signal
--     consumed by the consent-gate helper before every marketing send (NPS,
--     reactivation, medication reminder, birthday, referral reward). The
--     existing `consentMarketing` column is opt-IN and stays untouched.
--   Patient soft-delete columns (`deletedAt`, `deletionRequestedAt`,
--     `deletionReason`) — Wave 1 only reserves them; Wave 3 wires the DSAR
--     flow that actually flips them.
--   User TOTP / recovery-code / session-rotation columns — reserved in Wave 1
--     so Wave 2 (2FA) doesn't need a second migration.
--   PatientView — PHI access audit table. One row per
--     (viewer, patient, context) with a 5-minute throttle enforced in app
--     code (see src/server/audit/patient-view.ts).

-- Patient — marketing opt-out + soft-delete reservations.
ALTER TABLE "Patient"
    ADD COLUMN "marketingOptOut"       BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "marketingOptOutAt"     TIMESTAMP(3),
    ADD COLUMN "marketingOptOutSource" TEXT,
    ADD COLUMN "deletedAt"             TIMESTAMP(3),
    ADD COLUMN "deletionRequestedAt"   TIMESTAMP(3),
    ADD COLUMN "deletionReason"        TEXT;

-- User — Wave 2 reservations (totp, recovery codes, session rotation).
-- `recoveryCodesHash` defaults to an empty array so existing rows remain
-- valid without a backfill.
ALTER TABLE "User"
    ADD COLUMN "totpSecret"           TEXT,
    ADD COLUMN "totpEnabledAt"        TIMESTAMP(3),
    ADD COLUMN "recoveryCodesHash"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "lastSessionRotatedAt" TIMESTAMP(3);

-- PatientView — one row per opening of a patient PHI surface.
CREATE TABLE "PatientView" (
    "id"           TEXT NOT NULL,
    "clinicId"     TEXT NOT NULL,
    "viewerUserId" TEXT NOT NULL,
    "viewerRole"   TEXT NOT NULL,
    "patientId"    TEXT NOT NULL,
    "context"      TEXT NOT NULL,
    "contextRef"   TEXT,
    "ip"           TEXT,
    "userAgent"    TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientView_clinicId_patientId_createdAt_idx"
    ON "PatientView"("clinicId", "patientId", "createdAt");
CREATE INDEX "PatientView_clinicId_viewerUserId_createdAt_idx"
    ON "PatientView"("clinicId", "viewerUserId", "createdAt");
CREATE INDEX "PatientView_patientId_createdAt_idx"
    ON "PatientView"("patientId", "createdAt");

ALTER TABLE "PatientView"
    ADD CONSTRAINT "PatientView_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientView"
    ADD CONSTRAINT "PatientView_viewerUserId_fkey"
    FOREIGN KEY ("viewerUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientView"
    ADD CONSTRAINT "PatientView_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
