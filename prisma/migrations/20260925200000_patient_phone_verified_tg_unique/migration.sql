-- Patient identity (audit PH-01, MA-04, Q-03).
--
-- 1. `phoneVerifiedAt`: a phone typed into the Mini App is only a claim, yet
--    walk-in / kiosk / CRM lookups matched cards by phone, so a Telegram user
--    could put a stranger's number on his own card and later receive her
--    visits. From now on only a verified number is identity.
--
-- 2. One card per Telegram account per clinic: two cards sharing a
--    telegramId made the Mini App open one or the other at random.

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- Backfill: a real number ("+…") counts as verified unless it was typed in
-- the Mini App. Mini App cards carry source TELEGRAM and, unlike a card staff
-- created with source TELEGRAM (the inbox «create patient» flow), have no
-- `patient.create` audit row; their number, if any, was typed by the
-- Telegram user himself, unless staff later edited it in the CRM (a
-- `patient.update` audit whose diff carries the phone). Stubs (tg:,
-- family:, deleted:) stay unverified. Staff cards whose number the patient
-- later changed in the Mini App profile are handled by
-- scripts/fix-patient-telegram-identity.ts.
UPDATE "Patient" p
SET "phoneVerifiedAt" = p."createdAt"
WHERE p."phoneNormalized" LIKE '+%'
  AND NOT (
    COALESCE(p."source"::text, '') = 'TELEGRAM'
    AND NOT EXISTS (
      SELECT 1 FROM "AuditLog" a
      WHERE a."entityType" = 'Patient'
        AND a."entityId" = p."id"
        AND (
          a."action" = 'patient.create'
          OR (
            a."action" = 'patient.update'
            AND (
              (a."meta" -> 'after' -> 'phone') IS NOT NULL
              OR (a."meta" -> 'after' -> 'phoneNormalized') IS NOT NULL
            )
          )
        )
    )
  );

-- Telegram dedupe, so the unique index below can be built. Per (clinic,
-- telegramId) keep the card that is most likely the real one: a card with a
-- real number before an auto-created `tg:` card, a live card before a
-- deleted one, more visits first, then the oldest. The others lose the link.
-- Every unlink is written to AuditLog first (with the old telegramId and the
-- keeper) so nothing is lost: scripts/fix-patient-telegram-identity.ts reads
-- these rows to retire empty duplicates and to raise a reception task for
-- the rest.
WITH counted AS (
  SELECT
    p."id",
    p."clinicId",
    p."telegramId",
    p."telegramUsername",
    p."phoneNormalized",
    p."deletedAt",
    p."createdAt",
    (SELECT count(*) FROM "Appointment" ap WHERE ap."patientId" = p."id") AS appts
  FROM "Patient" p
  WHERE p."telegramId" IS NOT NULL
),
ranked AS (
  SELECT
    c.*,
    first_value(c."id") OVER w AS "keeperId",
    row_number() OVER w AS rn
  FROM counted c
  WINDOW w AS (
    PARTITION BY c."clinicId", c."telegramId"
    ORDER BY
      (c."phoneNormalized" LIKE 'tg:%') ASC,
      (c."deletedAt" IS NOT NULL) ASC,
      c.appts DESC,
      c."createdAt" ASC,
      c."id" ASC
  )
)
INSERT INTO "AuditLog" ("id", "clinicId", "action", "entityType", "entityId", "meta", "createdAt")
SELECT
  gen_random_uuid()::text,
  r."clinicId",
  'patient.telegram.dedupe_unlinked',
  'Patient',
  r."id",
  jsonb_build_object(
    'telegramId', r."telegramId",
    'telegramUsername', r."telegramUsername",
    'keeperId', r."keeperId",
    'source', 'migration 20260925200000_patient_phone_verified_tg_unique'
  ),
  NOW()
FROM ranked r
WHERE r.rn > 1;

UPDATE "Patient" p
SET "telegramId" = NULL,
    "telegramUsername" = NULL
FROM "AuditLog" a
WHERE a."action" = 'patient.telegram.dedupe_unlinked'
  AND a."entityType" = 'Patient'
  AND a."entityId" = p."id"
  AND p."telegramId" = a."meta"->>'telegramId';

-- DropIndex
DROP INDEX "Patient_clinicId_telegramId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Patient_clinicId_telegramId_key" ON "Patient"("clinicId", "telegramId");
