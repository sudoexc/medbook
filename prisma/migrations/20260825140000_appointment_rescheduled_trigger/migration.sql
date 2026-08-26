-- Reschedule notification — the patient must learn the NEW time.
--
-- Before this, moving an appointment was silent: no trigger existed for a
-- reschedule, so the patient kept the reminder cascade rendered against the
-- OLD time and showed up at the wrong hour. Adding the enum value lets a
-- template row bind to the reschedule event the same way APPOINTMENT_CANCELLED
-- binds to a cancel.
--
-- Guarded (IF NOT EXISTS) so a re-run or a partially-applied deploy is safe —
-- matches the repo's idempotent-DDL house style.

-- ADD VALUE is transaction-safe on PG12+ as long as the new value is not USED
-- in the same transaction (it is not — templates are seeded by app code).
ALTER TYPE "NotificationTrigger"
  ADD VALUE IF NOT EXISTS 'APPOINTMENT_RESCHEDULED' AFTER 'APPOINTMENT_CANCELLED';
