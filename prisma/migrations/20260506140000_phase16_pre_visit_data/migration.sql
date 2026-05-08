-- Phase 16 Wave 2 — Pre-visit questionnaire + post-visit NPS plumbing.
--
-- Adds 4 columns to Appointment for the engagement loops:
--   preVisitData         JSON blob (complaints/allergies/medications/notes)
--   preVisitNotifiedAt   dedupe stamp for the 24h-before TG push
--   preVisitSubmittedAt  set when the patient submits the Mini App form
--   npsRequestedAt       dedupe stamp for the +4h-after-COMPLETED NPS push
--
-- And one column to Clinic:
--   npsAlertThreshold    score < this triggers a LOW_NPS_RECEIVED Action.
--                        Default 7 (promoter/passive/detractor cutoff).
--                        Wave 3 exposes this in /crm/settings/clinic.

ALTER TABLE "Appointment" ADD COLUMN "preVisitData" JSONB;
ALTER TABLE "Appointment" ADD COLUMN "preVisitNotifiedAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN "preVisitSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN "npsRequestedAt" TIMESTAMP(3);

ALTER TABLE "Clinic" ADD COLUMN "npsAlertThreshold" INTEGER NOT NULL DEFAULT 7;
