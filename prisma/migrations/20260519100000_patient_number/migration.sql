-- Human-readable per-clinic patient number ("P-00125").
--
-- Schema:
--   Patient.patientNumber INTEGER NOT NULL
--   Clinic.patientCounter INTEGER NOT NULL DEFAULT 0
--   UNIQUE(clinicId, patientNumber)
--
-- Backfill: existing patients are numbered per-clinic in creation order
-- (createdAt ASC, then id ASC as a tiebreaker for rows created in the
-- same millisecond). Each clinic's counter is then advanced to that
-- clinic's highest assigned number so future allocations continue from
-- there.

ALTER TABLE "Clinic" ADD COLUMN "patientCounter" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Patient" ADD COLUMN "patientNumber" INTEGER;

WITH numbered AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "clinicId"
            ORDER BY "createdAt" ASC, "id" ASC
        ) AS "rn"
    FROM "Patient"
)
UPDATE "Patient" p
SET "patientNumber" = numbered."rn"
FROM numbered
WHERE p."id" = numbered."id";

UPDATE "Clinic" c
SET "patientCounter" = COALESCE(
    (SELECT MAX("patientNumber") FROM "Patient" WHERE "clinicId" = c."id"),
    0
);

ALTER TABLE "Patient" ALTER COLUMN "patientNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Patient_clinicId_patientNumber_key"
    ON "Patient"("clinicId", "patientNumber");
