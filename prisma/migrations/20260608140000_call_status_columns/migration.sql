-- Add explicit call-lifecycle columns so the client/CRM no longer has to
-- derive status from (direction, endedAt, tags). Closes the TODO at
-- src/app/api/calls/sip/event/route.ts (prisma-schema-owner) and the
-- matching TODO in src/app/[locale]/crm/call-center/_hooks/types.ts.
--
-- Idempotent: all DDL uses IF NOT EXISTS; backfill UPDATEs guard on
-- `status IS NULL` so re-runs are no-ops.

DO $$
BEGIN
  CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ANSWERED', 'ENDED', 'MISSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "status"     "CallStatus";
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "startedAt"  TIMESTAMP(3);
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "answeredAt" TIMESTAMP(3);

-- Closest available signal for legacy rows: the row's createdAt is the
-- moment the webhook recorded the call, which is the ringing edge.
UPDATE "Call"
   SET "startedAt" = "createdAt"
 WHERE "startedAt" IS NULL;

-- Backfill status in order of specificity. Each UPDATE excludes rows
-- already set so the chain is stable under repeated runs.
UPDATE "Call"
   SET "status" = 'MISSED'
 WHERE "status" IS NULL
   AND "direction" = 'MISSED';

UPDATE "Call"
   SET "status" = 'ENDED',
       "answeredAt" = COALESCE("answeredAt", "createdAt")
 WHERE "status" IS NULL
   AND "endedAt" IS NOT NULL
   AND 'answered' = ANY("tags");

UPDATE "Call"
   SET "status" = 'MISSED'
 WHERE "status" IS NULL
   AND "endedAt" IS NOT NULL;

UPDATE "Call"
   SET "status" = 'ANSWERED',
       "answeredAt" = COALESCE("answeredAt", "createdAt")
 WHERE "status" IS NULL
   AND 'answered' = ANY("tags");

UPDATE "Call"
   SET "status" = 'RINGING'
 WHERE "status" IS NULL;

CREATE INDEX IF NOT EXISTS "Call_clinicId_status_createdAt_idx"
  ON "Call" ("clinicId", "status", "createdAt");
