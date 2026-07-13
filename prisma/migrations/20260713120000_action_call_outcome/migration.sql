-- Call-outcome capture on Action (TZ-risk-outcomes). Additive: nullable
-- columns + a default counter; no backfill needed (existing rows have no
-- recorded outcome).
ALTER TABLE "Action" ADD COLUMN "outcome" TEXT;
ALTER TABLE "Action" ADD COLUMN "outcomeNote" TEXT;
ALTER TABLE "Action" ADD COLUMN "callbackAt" TIMESTAMP(3);
ALTER TABLE "Action" ADD COLUMN "resolvedById" TEXT;
ALTER TABLE "Action" ADD COLUMN "callAttempts" INTEGER NOT NULL DEFAULT 0;
