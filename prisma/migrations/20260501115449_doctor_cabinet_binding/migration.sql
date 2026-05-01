-- Doctor↔Cabinet 1:1 binding migration.
--
-- Why: product owner requires that every doctor occupies exactly one
-- cabinet, and a cabinet hosts at most one doctor. The previous model let
-- cabinets float free of doctors and let DoctorSchedule choose any cabinet
-- per shift; that's now collapsed to a single hard binding on Doctor.
--
-- Strategy:
--   1. Add Doctor.cabinetId nullable so existing rows keep loading.
--   2. For each clinic, count doctors and cabinets. Top up cabinets with
--      auto-numbered placeholders ("auto-N") so cabinets >= doctors.
--   3. Pair doctors with cabinets in a deterministic order (createdAt asc,
--      id tiebreak) and write doctorId → cabinetId.
--   4. Drop DoctorSchedule.cabinetId (cabinet is now derived from doctor).
--   5. Add ServiceOnDoctor.durationMinOverride for per-doctor service length.
--   6. Tighten Doctor.cabinetId to NOT NULL + UNIQUE + FK.
--
-- All in one transaction. If the backfill leaves any doctor without a cabinet
-- (e.g. an empty clinic with doctors but no cabinets and the auto-create
-- step for some reason failed), step 6 fails and the whole thing rolls back.

BEGIN;

-- 1. Nullable column first so the FK + UNIQUE can land after backfill.
ALTER TABLE "Doctor" ADD COLUMN "cabinetId" TEXT;

-- 2. For each clinic, top up cabinets so count(cabinets) >= count(doctors).
--    Auto-numbered cabinets get a unique-within-clinic "number" derived from
--    the highest existing numeric suffix to avoid the (clinicId, number) UQ.
DO $$
DECLARE
  c RECORD;
  doc_count INT;
  cab_count INT;
  needed INT;
  next_num INT;
  i INT;
  new_id TEXT;
BEGIN
  FOR c IN SELECT id FROM "Clinic" LOOP
    SELECT COUNT(*) INTO doc_count FROM "Doctor" WHERE "clinicId" = c.id;
    SELECT COUNT(*) INTO cab_count FROM "Cabinet" WHERE "clinicId" = c.id;
    needed := GREATEST(0, doc_count - cab_count);
    IF needed > 0 THEN
      -- Pick the next numeric suffix safely. We try to extract trailing
      -- digits from existing "number" values; if none, start at 1.
      SELECT COALESCE(MAX(NULLIF(regexp_replace("number", '\D', '', 'g'), '')::INT), 0) + 1
        INTO next_num
        FROM "Cabinet" WHERE "clinicId" = c.id;
      FOR i IN 1..needed LOOP
        new_id := 'c' || substr(md5(random()::text || clock_timestamp()::text || c.id || i::text), 1, 24);
        INSERT INTO "Cabinet" (id, "clinicId", number, "isActive", equipment, "createdAt", "updatedAt")
        VALUES (
          new_id,
          c.id,
          (next_num + i - 1)::TEXT,
          true,
          ARRAY[]::TEXT[],
          NOW(),
          NOW()
        );
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- 3. Pair doctors with cabinets deterministically. ROW_NUMBER over the same
--    ORDER BY for both sides → first doctor (by createdAt) gets first cabinet.
WITH doctors_ranked AS (
  SELECT id, "clinicId",
         ROW_NUMBER() OVER (PARTITION BY "clinicId" ORDER BY "createdAt", id) AS rn
  FROM "Doctor"
),
cabinets_ranked AS (
  SELECT id, "clinicId",
         ROW_NUMBER() OVER (PARTITION BY "clinicId" ORDER BY "createdAt", id) AS rn
  FROM "Cabinet"
),
pairs AS (
  SELECT d.id AS doctor_id, c.id AS cabinet_id
  FROM doctors_ranked d
  JOIN cabinets_ranked c ON d."clinicId" = c."clinicId" AND d.rn = c.rn
)
UPDATE "Doctor"
SET "cabinetId" = pairs.cabinet_id
FROM pairs
WHERE "Doctor".id = pairs.doctor_id;

-- 4. DoctorSchedule.cabinetId is redundant now (always = doctor.cabinetId).
ALTER TABLE "DoctorSchedule" DROP COLUMN "cabinetId";

-- 5. Per-doctor service-duration override.
ALTER TABLE "ServiceOnDoctor" ADD COLUMN "durationMinOverride" INTEGER;

-- 6. Tighten Doctor.cabinetId. If any doctor is still NULL here, the
--    transaction rolls back — that's the intended safety net.
ALTER TABLE "Doctor" ALTER COLUMN "cabinetId" SET NOT NULL;
ALTER TABLE "Doctor"
  ADD CONSTRAINT "Doctor_cabinetId_key" UNIQUE ("cabinetId");
ALTER TABLE "Doctor"
  ADD CONSTRAINT "Doctor_cabinetId_fkey"
  FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
