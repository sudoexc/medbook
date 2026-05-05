-- Phase 12 — multi-step appointment reminder cascade + INAPP channel +
-- repeat-visit reminder for MedicalCase.
--
-- Adds:
--   1. CommunicationChannel.INAPP — in-app banner shown in Mini App + CRM
--      patient portal. Always-on parallel touch when patient.telegramId is
--      present. No external send cost.
--   2. NotificationTrigger.CASE_REPEAT_DUE — fires N days before the
--      free-repeat window of a MedicalCase's first visit closes, prompting
--      the patient to book a follow-up.
--   3. NotificationSend.caseId (NULL FK to MedicalCase) — dedupe key for
--      CASE_REPEAT_DUE. Indexed (clinicId, caseId, templateId) so the
--      idempotency check is one ix-only query per tick.
--   4. NotificationSend (patientId, channel, status, readAt) index — used
--      by /api/miniapp/inbox to fetch unread INAPP rows in <5ms.
--
-- All changes are additive: no existing rows or queries break.

-- AlterEnum
ALTER TYPE "CommunicationChannel" ADD VALUE 'INAPP';

-- AlterEnum
ALTER TYPE "NotificationTrigger" ADD VALUE 'CASE_REPEAT_DUE';

-- AlterTable
ALTER TABLE "NotificationSend" ADD COLUMN "caseId" TEXT;

-- AddForeignKey
ALTER TABLE "NotificationSend"
  ADD CONSTRAINT "NotificationSend_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "MedicalCase"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "NotificationSend_clinicId_caseId_templateId_idx"
  ON "NotificationSend"("clinicId", "caseId", "templateId");

-- CreateIndex
CREATE INDEX "NotificationSend_patientId_channel_status_readAt_idx"
  ON "NotificationSend"("patientId", "channel", "status", "readAt");
