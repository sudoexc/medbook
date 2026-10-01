-- Notification pipeline reliability (audit TG-06, TG-08, TG-12).
--
--   appointmentAt  Appointment.date the row was written for: the send worker's
--                  stale-time guard compares it with the current start, so a
--                  retry or backoff may move scheduledFor freely.
--   claimedAt      when a worker claimed the row (QUEUED -> SENDING); rows
--                  stuck in SENDING past the timeout are swept back.
--   failedAt       when the row reached FAILED; «Ошибки сегодня» counts by it.
--
-- All nullable, no backfill: existing rows keep working through the fallbacks
-- in the worker (anchor derived from scheduledFor, SENDING without claimedAt
-- treated as stale).

-- AlterTable
ALTER TABLE "NotificationSend" ADD COLUMN     "appointmentAt" TIMESTAMP(3),
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "failedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "NotificationSend_status_scheduledFor_idx" ON "NotificationSend"("status", "scheduledFor");
