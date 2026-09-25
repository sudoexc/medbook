-- Review of AC-01 / AC-03: work lists order Action rows by the moment they
-- became actionable. A snoozed task, or a control-visit call scheduled weeks
-- ahead, keeps its old `createdAt`, so ordering by it buried the row under
-- newer ones exactly when it came back.
-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "surfacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Action_clinicId_severity_surfacedAt_idx" ON "Action"("clinicId", "severity", "surfacedAt");

-- Backfill: a row surfaced when it was created, or when its snooze / scheduled
-- surface time ran out (GREATEST skips a NULL snoozeUntil). Without this every
-- existing row would share the migration timestamp.
UPDATE "Action" SET "surfacedAt" = GREATEST("createdAt", "snoozeUntil");
