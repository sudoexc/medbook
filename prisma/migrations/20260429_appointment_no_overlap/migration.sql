-- Hard backstop against doctor/cabinet double-bookings. Until now the only
-- guard was application-level (`detectConflicts` in the CRM + Mini App POST
-- handlers). Anything that bypassed it — seed scripts, future raw SQL,
-- background jobs — could insert overlapping appointments. This migration
-- adds a Postgres EXCLUDE USING gist constraint so overlapping rows fail at
-- the storage layer.
--
-- Requires the `btree_gist` extension to mix the `=` operator on doctorId/
-- cabinetId with the `&&` overlap operator on a tsrange. Cancelled and
-- no-show rows are excluded (their slot is considered free).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Cleanup pass: in any cluster of overlapping non-cancelled rows, keep the
-- one with the smallest (createdAt, id). Single-pass `EXISTS` query — for
-- demo data this collapses overlap chains in one shot. Cancelled and
-- no-show rows are not touched (they don't participate in the constraint).
DELETE FROM "Appointment" a
WHERE a."status" NOT IN ('CANCELLED', 'NO_SHOW')
  AND EXISTS (
    SELECT 1 FROM "Appointment" b
    WHERE b."id" <> a."id"
      AND b."status" NOT IN ('CANCELLED', 'NO_SHOW')
      AND b."doctorId" = a."doctorId"
      AND b."date" < a."endDate"
      AND b."endDate" > a."date"
      AND (
        b."createdAt" < a."createdAt"
        OR (b."createdAt" = a."createdAt" AND b."id" < a."id")
      )
  );

DELETE FROM "Appointment" a
WHERE a."cabinetId" IS NOT NULL
  AND a."status" NOT IN ('CANCELLED', 'NO_SHOW')
  AND EXISTS (
    SELECT 1 FROM "Appointment" b
    WHERE b."id" <> a."id"
      AND b."cabinetId" = a."cabinetId"
      AND b."status" NOT IN ('CANCELLED', 'NO_SHOW')
      AND b."date" < a."endDate"
      AND b."endDate" > a."date"
      AND (
        b."createdAt" < a."createdAt"
        OR (b."createdAt" = a."createdAt" AND b."id" < a."id")
      )
  );

-- Per-doctor: no two non-cancelled appointments may overlap on the same
-- doctor. Using `[)` so a 12:00–12:30 and a 12:30–13:00 slot are *not*
-- considered overlapping (touching at 12:30 is fine).
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_doctor_no_overlap"
  EXCLUDE USING gist (
    "doctorId" WITH =,
    tsrange("date", "endDate", '[)') WITH &&
  ) WHERE ("status" NOT IN ('CANCELLED', 'NO_SHOW'));

-- Per-cabinet: same, but only when a cabinet is assigned. Walk-ins/telemed
-- without a cabinet (cabinetId IS NULL) are not constrained on this axis.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_cabinet_no_overlap"
  EXCLUDE USING gist (
    "cabinetId" WITH =,
    tsrange("date", "endDate", '[)') WITH &&
  ) WHERE ("status" NOT IN ('CANCELLED', 'NO_SHOW') AND "cabinetId" IS NOT NULL);
