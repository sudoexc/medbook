-- Phase 16 Wave 3 — Medication reminders + Refer-a-friend rewards + clinic
-- patient-experience settings.
--
-- Two new models:
--   MedicationReminderSend — one row per "this prescription is due at this
--     tick" event. Worker dedupes via the (prescriptionId, scheduledFor)
--     unique key. Drives the Mini App medications dashboard (mark-taken /
--     skip / snooze).
--   ReferralReward         — one row per (referrer, referred) pair, minted
--     when the referred patient's first appointment hits COMPLETED, then
--     auto-applied to the referrer's next BOOKED appointment.
--
-- Two new clinic-level settings (exposed in Wave 3 /crm/settings/clinic):
--   referralRewardPercent       0..50 — percent off the referrer's next
--                               booking. Snapshot into ReferralReward at
--                               issue time so later setting changes don't
--                               rewrite pending rewards.
--   medicationRemindersEnabled  master kill switch for the worker.
--
-- One new Lead column:
--   referrerPatientId  attribution back-pointer when a referral code lands a
--                      lead. Indexed for the per-referrer lead count widget.

ALTER TABLE "Clinic" ADD COLUMN "referralRewardPercent" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "Clinic" ADD COLUMN "medicationRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Lead" ADD COLUMN "referrerPatientId" TEXT;
CREATE INDEX "Lead_clinicId_referrerPatientId_idx" ON "Lead"("clinicId", "referrerPatientId");

-- MedicationReminderSend ------------------------------------------------------
CREATE TABLE "MedicationReminderSend" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "snoozeUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationReminderSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MedicationReminderSend_prescriptionId_scheduledFor_key"
    ON "MedicationReminderSend"("prescriptionId", "scheduledFor");
CREATE INDEX "MedicationReminderSend_clinicId_patientId_status_idx"
    ON "MedicationReminderSend"("clinicId", "patientId", "status");
CREATE INDEX "MedicationReminderSend_clinicId_status_scheduledFor_idx"
    ON "MedicationReminderSend"("clinicId", "status", "scheduledFor");

ALTER TABLE "MedicationReminderSend"
    ADD CONSTRAINT "MedicationReminderSend_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicationReminderSend"
    ADD CONSTRAINT "MedicationReminderSend_prescriptionId_fkey"
    FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicationReminderSend"
    ADD CONSTRAINT "MedicationReminderSend_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ReferralReward --------------------------------------------------------------
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "referrerPatientId" TEXT NOT NULL,
    "referredPatientId" TEXT NOT NULL,
    "rewardPercent" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMP(3),
    "appliedAppointmentId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralReward_referrerPatientId_referredPatientId_key"
    ON "ReferralReward"("referrerPatientId", "referredPatientId");
CREATE INDEX "ReferralReward_clinicId_referrerPatientId_status_idx"
    ON "ReferralReward"("clinicId", "referrerPatientId", "status");
CREATE INDEX "ReferralReward_clinicId_status_expiresAt_idx"
    ON "ReferralReward"("clinicId", "status", "expiresAt");

ALTER TABLE "ReferralReward"
    ADD CONSTRAINT "ReferralReward_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralReward"
    ADD CONSTRAINT "ReferralReward_referrerPatientId_fkey"
    FOREIGN KEY ("referrerPatientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralReward"
    ADD CONSTRAINT "ReferralReward_referredPatientId_fkey"
    FOREIGN KEY ("referredPatientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
