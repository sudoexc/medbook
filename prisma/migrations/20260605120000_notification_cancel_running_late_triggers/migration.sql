-- Extend NotificationTrigger enum with two new values used by the day-of
-- cascade + cancel/late notification flows (TZ-notifications-cancel-sync §7.2):
--
--   APPOINTMENT_CANCELLED    fired by `cancelAppointment` kernel, two text
--                            variants (by-staff vs. by-patient) selected at
--                            send time based on the originating surface.
--   APPOINTMENT_RUNNING_LATE fired by `appointment-lifecycle-sweep` when
--                            `isRunningLate(row, now)` and no prior send for
--                            this (appointmentId, templateId) pair.
--
-- ADD VALUE is transactional only on Postgres ≥ 12; we're on 16, so this
-- runs inline. Order in the enum matters for `prisma db pull` round-trips —
-- insert before APPOINTMENT_MISSED to match the schema source-of-truth.

ALTER TYPE "NotificationTrigger" ADD VALUE IF NOT EXISTS 'APPOINTMENT_CANCELLED' BEFORE 'APPOINTMENT_MISSED';
ALTER TYPE "NotificationTrigger" ADD VALUE IF NOT EXISTS 'APPOINTMENT_RUNNING_LATE' BEFORE 'APPOINTMENT_MISSED';
