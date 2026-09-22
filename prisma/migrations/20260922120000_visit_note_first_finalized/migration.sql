-- Immutability clock for signed conclusions.
--
-- The revert flow clears `finalizedAt`; re-signing re-stamps it, which used to
-- reopen the 24h destructive-edit window on arbitrarily old documents and let
-- them be rewritten outside the append-only amendment trail. The edit window
-- now runs off `firstFinalizedAt`, which is stamped once and never cleared.
ALTER TABLE "VisitNote" ADD COLUMN IF NOT EXISTS "firstFinalizedAt" TIMESTAMP(3);

-- Backfill: every note signed before this migration keeps its original clock.
UPDATE "VisitNote"
SET "firstFinalizedAt" = "finalizedAt"
WHERE "finalizedAt" IS NOT NULL AND "firstFinalizedAt" IS NULL;
