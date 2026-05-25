-- Wave 3: promote pre-visit confirmation to a first-class lifecycle state.
-- Until now reception's "patient confirmed by phone" was indistinguishable
-- from a freshly-booked slot, which forced the unconfirmed-24h detector,
-- the reminder worker, and the no-show risk scorer to all guess at intent.
-- Add a dedicated CONFIRMED status between BOOKED and WAITING so each of
-- those flows can read state directly instead of inferring it.
--
-- ALTER TYPE ... ADD VALUE is non-blocking on Postgres ≥12 and does not
-- rewrite the underlying table — no rows reference CONFIRMED yet.
ALTER TYPE "AppointmentStatus" ADD VALUE 'CONFIRMED' AFTER 'BOOKED';
