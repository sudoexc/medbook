-- Phase 19 Wave 1 — plan-limit foundation.
--
-- This migration lands the schema-side groundwork for Wave 1's usage tracking
-- + plan-limit enforcement. Three changes ship together so a single rollout
-- transition gets all the new shape:
--
--   1. Extend `Plan.features` JSON with the six new keys (4 ints + 2 bools)
--      using `jsonb_build_object` so existing keys are preserved. Defaults
--      vary per tier — Basic is the hard-block target, Pro is generous,
--      Enterprise is unlimited (-1 sentinel) across the board.
--
--   2. Add four `Clinic` columns for white-label / onboarding plumbing.
--      `customSubdomain` is globally unique (it routes traffic).
--
--   3. Create `Invoice` table + `InvoiceStatus` enum. Wave 4 wires the
--      Click/Payme webhook flips; Wave 1 just reserves the storage.

-- ─── 1. Extend Plan.features per-tier ────────────────────────────────────
UPDATE "Plan"
   SET features = features || jsonb_build_object(
     'maxPatients',             50,
     'maxAppointmentsPerMonth', 100,
     'maxSmsPerMonth',          200,
     'maxStorageMb',            500,
     'hasWhiteLabel',           false,
     'hasCustomSubdomain',      false
   )
 WHERE slug = 'basic';

UPDATE "Plan"
   SET features = features || jsonb_build_object(
     'maxPatients',             500,
     'maxAppointmentsPerMonth', 2000,
     'maxSmsPerMonth',          5000,
     'maxStorageMb',            10000,
     'hasWhiteLabel',           true,
     'hasCustomSubdomain',      false
   )
 WHERE slug = 'pro';

UPDATE "Plan"
   SET features = features || jsonb_build_object(
     'maxPatients',             -1,
     'maxAppointmentsPerMonth', -1,
     'maxSmsPerMonth',          -1,
     'maxStorageMb',            -1,
     'hasWhiteLabel',           true,
     'hasCustomSubdomain',      true
   )
 WHERE slug = 'enterprise';

-- ─── 2. Clinic columns ───────────────────────────────────────────────────
ALTER TABLE "Clinic"
  ADD COLUMN "customSubdomain"     TEXT,
  ADD COLUMN "brandSecondaryColor" TEXT,
  ADD COLUMN "onboardedAt"         TIMESTAMP(3),
  ADD COLUMN "onboardingPlaybook"  TEXT;

CREATE UNIQUE INDEX "Clinic_customSubdomain_key" ON "Clinic"("customSubdomain");

-- ─── 3. Invoice table + enum ─────────────────────────────────────────────
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID', 'OVERDUE');

CREATE TABLE "Invoice" (
    "id"          TEXT             NOT NULL,
    "clinicId"    TEXT             NOT NULL,
    "number"      TEXT             NOT NULL,
    "status"      "InvoiceStatus"  NOT NULL DEFAULT 'DRAFT',
    "amountTiins" BIGINT           NOT NULL,
    "currency"    "Currency"       NOT NULL DEFAULT 'UZS',
    "periodStart" TIMESTAMP(3)     NOT NULL,
    "periodEnd"   TIMESTAMP(3)     NOT NULL,
    "dueAt"       TIMESTAMP(3)     NOT NULL,
    "paidAt"      TIMESTAMP(3),
    "paymentRef"  TEXT,
    "pdfUrl"      TEXT,
    "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX "Invoice_clinicId_createdAt_idx" ON "Invoice"("clinicId", "createdAt");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
