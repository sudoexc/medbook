-- Wave 3.5: confirmation audit columns + ConfirmationVia enum.
--
-- `Appointment.status === 'CONFIRMED'` answers "is it confirmed right now",
-- but we also need to know WHEN, BY WHOM, and HOW the confirmation happened.
-- That history powers (a) idempotent dedupe of the T-3d/T-1d/T-2h confirm-call
-- tasks, (b) "avg time from booking to confirmation by channel" reports, and
-- (c) routing of inbound SMS-YES / TG-button responses to the right handler.
--
-- All three columns are nullable; existing rows stay NULL and the detectors
-- treat them the same as never-confirmed. No backfill needed.

CREATE TYPE "ConfirmationVia" AS ENUM (
  'BOOKING_AUTO',
  'MANUAL_CRM',
  'SMS_REPLY',
  'TG_BUTTON',
  'INBOUND_CALL'
);

ALTER TABLE "Appointment"
  ADD COLUMN "confirmedAt"  TIMESTAMP(3),
  ADD COLUMN "confirmedBy"  TEXT,
  ADD COLUMN "confirmedVia" "ConfirmationVia";

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_confirmedBy_fkey"
  FOREIGN KEY ("confirmedBy") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Confirmation-window detectors hit this thousands of times per scheduler
-- tick — "appointments in [now+window-Δ, now+window] with confirmedAt IS
-- NULL". A composite (clinicId, date, confirmedAt) keeps the scan bounded;
-- Postgres treats trailing NULLs as their own group, so the predicate
-- `confirmedAt IS NULL` still hits the index.
CREATE INDEX "Appointment_clinicId_date_confirmedAt_idx"
  ON "Appointment"("clinicId", "date", "confirmedAt");
