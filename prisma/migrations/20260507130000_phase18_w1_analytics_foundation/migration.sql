-- Phase 18 Wave 1 — Analytics & Reporting foundation.
--
-- Three deliverables in this migration:
--
--   1. SavedReport / ScheduledReport tables — persistence for the W3 report
--      builder + W4 scheduled-delivery cron. W1 only shapes the storage; the
--      W3 builder owns the `config` JSON shape, the W4 cron owns the
--      cadence/picker logic.
--
--   2. Materialized views (mv_doctor_performance, mv_cohort_retention,
--      mv_financial_pace, mv_schedule_heatmap) — pre-aggregated rollups
--      that the dashboard resolvers read. Created WITH NO DATA so the
--      migration stays cheap; an async refresh on worker boot populates
--      them. Each view carries `clinicId` as the leading column for
--      tenant filtering, plus a UNIQUE INDEX on `(clinicId, …)` so the
--      hourly REFRESH MATERIALIZED VIEW CONCURRENTLY can run without an
--      AccessExclusiveLock that would block readers.
--
--   3. Helper enums for ScheduledReport (cadence + delivery channel).
--
-- Encrypted PII fields (Phase 17 W4 — Patient.notes/passport, MedicalCase.soapDraft,
-- Prescription.notes) are AES-encrypted at rest and intentionally absent from
-- every aggregation here. We aggregate over fullName, phoneNormalized,
-- birthDate, gender, clinicId, branchId, doctorId — all unencrypted columns.
--
-- Soft-deleted patients (Patient.deletedAt IS NOT NULL, Phase 17 W3 DSAR) are
-- excluded from every view: anonymized rows must never appear as identifiable
-- entries in analytics.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE "ScheduledReportCadence"  AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "ScheduledReportChannel"  AS ENUM ('EMAIL', 'TELEGRAM');

-- ─────────────────────────────────────────────────────────────────────────────
-- SavedReport — opaque builder configuration persisted by the W3 report builder.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "SavedReport" (
    "id"              TEXT NOT NULL,
    "clinicId"        TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "description"     TEXT,
    "config"          JSONB NOT NULL,
    "lastRunAt"       TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedReport_clinicId_createdAt_idx"
    ON "SavedReport"("clinicId", "createdAt" DESC);
CREATE INDEX "SavedReport_createdByUserId_idx"
    ON "SavedReport"("createdByUserId");

ALTER TABLE "SavedReport"
    ADD CONSTRAINT "SavedReport_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedReport"
    ADD CONSTRAINT "SavedReport_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- ScheduledReport — cadence-driven delivery tied to a SavedReport.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "ScheduledReport" (
    "id"                TEXT NOT NULL,
    "clinicId"          TEXT NOT NULL,
    "savedReportId"     TEXT NOT NULL,
    "cadence"           "ScheduledReportCadence" NOT NULL,
    "nextRunAt"         TIMESTAMP(3) NOT NULL,
    "deliveryChannel"   "ScheduledReportChannel" NOT NULL,
    "deliveryTarget"    TEXT NOT NULL,
    "enabled"           BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveredAt"   TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- The W4 picker selects (enabled = true AND nextRunAt <= now()) — keep
-- both columns leading and INCLUDE-friendly. Postgres index on a boolean
-- column is fine here because almost all rows are `enabled = true`; the
-- selector still uses nextRunAt to bound row count.
CREATE INDEX "ScheduledReport_enabled_nextRunAt_idx"
    ON "ScheduledReport"("enabled", "nextRunAt");
CREATE INDEX "ScheduledReport_clinicId_idx"
    ON "ScheduledReport"("clinicId");
CREATE INDEX "ScheduledReport_savedReportId_idx"
    ON "ScheduledReport"("savedReportId");

ALTER TABLE "ScheduledReport"
    ADD CONSTRAINT "ScheduledReport_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledReport"
    ADD CONSTRAINT "ScheduledReport_savedReportId_fkey"
    FOREIGN KEY ("savedReportId") REFERENCES "SavedReport"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- mv_doctor_performance — per-doctor per-month rollup.
--
-- Filter:  status IN (COMPLETED, NO_SHOW); excludes BOOKED/IN_PROGRESS/
--          WAITING/SKIPPED/CANCELLED and future-dated rows. Soft-deleted
--          patients filtered out.
-- Grain:   one row per (clinicId, doctorId, month) bucket.
-- Columns: visitsCount = COMPLETED count;
--          revenueTiins = sum of completed revenue (priceFinal coalesced
--                         to priceService - discountAmount, in tiins);
--          noShowCount, repeatVisitCount (patient had a prior COMPLETED
--          appointment with this doctor before the bucket start),
--          newPatientCount (cohort-month == bucket-month for this doctor),
--          npsAvg (avg of PatientReview.score joined on appointmentId,
--                  null when no scores in that bucket),
--          npsCount.
--
-- Using `ROW_NUMBER` over a per-doctor-patient ordering is the cheapest
-- way to flag "first vs. repeat" without joining the same table twice.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW "mv_doctor_performance" AS
WITH ordered AS (
    SELECT
        a."clinicId",
        a."doctorId",
        a."patientId",
        a."status",
        a."date",
        date_trunc('month', a."date") AS "month",
        COALESCE(a."priceFinal", COALESCE(a."priceService", 0) - COALESCE(a."discountAmount", 0)) AS "revenueTiins",
        ROW_NUMBER() OVER (
            PARTITION BY a."doctorId", a."patientId"
            ORDER BY a."date" ASC
        ) AS "visitOrder"
    FROM "Appointment" a
    JOIN "Patient" p
        ON p."id" = a."patientId"
       AND p."deletedAt" IS NULL
    WHERE a."status" IN ('COMPLETED', 'NO_SHOW')
      AND a."date" <= NOW()
),
nps AS (
    SELECT
        r."clinicId",
        r."doctorId",
        date_trunc('month', a."date") AS "month",
        AVG(r."score")::float AS "npsAvg",
        COUNT(*)::bigint     AS "npsCount"
    FROM "PatientReview" r
    JOIN "Appointment" a
        ON a."id" = r."appointmentId"
    WHERE r."doctorId" IS NOT NULL
      AND r."appointmentId" IS NOT NULL
    GROUP BY r."clinicId", r."doctorId", date_trunc('month', a."date")
),
agg AS (
    SELECT
        o."clinicId",
        o."doctorId",
        o."month",
        SUM(CASE WHEN o."status" = 'COMPLETED' THEN 1 ELSE 0 END)::bigint AS "visitsCount",
        SUM(CASE WHEN o."status" = 'COMPLETED' THEN o."revenueTiins" ELSE 0 END)::bigint AS "revenueTiins",
        SUM(CASE WHEN o."status" = 'NO_SHOW'   THEN 1 ELSE 0 END)::bigint AS "noShowCount",
        SUM(CASE WHEN o."status" = 'COMPLETED' AND o."visitOrder" >  1 THEN 1 ELSE 0 END)::bigint AS "repeatVisitCount",
        SUM(CASE WHEN o."status" = 'COMPLETED' AND o."visitOrder" =  1 THEN 1 ELSE 0 END)::bigint AS "newPatientCount"
    FROM ordered o
    GROUP BY o."clinicId", o."doctorId", o."month"
)
SELECT
    agg."clinicId",
    agg."doctorId",
    agg."month",
    agg."visitsCount",
    agg."revenueTiins",
    agg."noShowCount",
    agg."repeatVisitCount",
    agg."newPatientCount",
    nps."npsAvg",
    COALESCE(nps."npsCount", 0)::bigint AS "npsCount"
FROM agg
LEFT JOIN nps
    ON nps."clinicId" = agg."clinicId"
   AND nps."doctorId" = agg."doctorId"
   AND nps."month"    = agg."month"
WITH NO DATA;

-- REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index that
-- covers every row exactly once — clinicId+doctorId+month is the natural key.
CREATE UNIQUE INDEX "mv_doctor_performance_pk_idx"
    ON "mv_doctor_performance" ("clinicId", "doctorId", "month");
CREATE INDEX "mv_doctor_performance_clinic_month_idx"
    ON "mv_doctor_performance" ("clinicId", "month" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- mv_cohort_retention — patient cohort retention matrix.
--
-- Window: capped at 24 months of `monthOffset` (0..23). Wider windows hurt
-- refresh latency for marginal value at this stage; if a 3-year retention
-- view becomes a real product requirement, raise the cap then.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW "mv_cohort_retention" AS
WITH first_visit AS (
    SELECT
        a."clinicId",
        a."patientId",
        date_trunc('month', MIN(a."date")) AS "cohortMonth"
    FROM "Appointment" a
    JOIN "Patient" p
        ON p."id" = a."patientId"
       AND p."deletedAt" IS NULL
    WHERE a."status" = 'COMPLETED'
      AND a."date" <= NOW()
    GROUP BY a."clinicId", a."patientId"
),
visits AS (
    SELECT DISTINCT
        a."clinicId",
        a."patientId",
        date_trunc('month', a."date") AS "visitMonth"
    FROM "Appointment" a
    JOIN "Patient" p
        ON p."id" = a."patientId"
       AND p."deletedAt" IS NULL
    WHERE a."status" = 'COMPLETED'
      AND a."date" <= NOW()
)
SELECT
    fv."clinicId",
    fv."cohortMonth",
    (
        (EXTRACT(YEAR FROM v."visitMonth") - EXTRACT(YEAR FROM fv."cohortMonth")) * 12
      + (EXTRACT(MONTH FROM v."visitMonth") - EXTRACT(MONTH FROM fv."cohortMonth"))
    )::int AS "monthOffset",
    COUNT(DISTINCT fv."patientId")::bigint AS "activePatientCount"
FROM first_visit fv
JOIN visits v
    ON v."clinicId"  = fv."clinicId"
   AND v."patientId" = fv."patientId"
WHERE
        (EXTRACT(YEAR FROM v."visitMonth") - EXTRACT(YEAR FROM fv."cohortMonth")) * 12
      + (EXTRACT(MONTH FROM v."visitMonth") - EXTRACT(MONTH FROM fv."cohortMonth"))
    BETWEEN 0 AND 23
GROUP BY fv."clinicId", fv."cohortMonth",
    (
        (EXTRACT(YEAR FROM v."visitMonth") - EXTRACT(YEAR FROM fv."cohortMonth")) * 12
      + (EXTRACT(MONTH FROM v."visitMonth") - EXTRACT(MONTH FROM fv."cohortMonth"))
    )
WITH NO DATA;

CREATE UNIQUE INDEX "mv_cohort_retention_pk_idx"
    ON "mv_cohort_retention" ("clinicId", "cohortMonth", "monthOffset");

-- ─────────────────────────────────────────────────────────────────────────────
-- mv_financial_pace — daily financial roll-up.
--
-- One row per (clinicId, day) covering 90 days back through 30 days forward.
-- The forward window lets the dashboard show "scheduled revenue today/this
-- week" without an extra query.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW "mv_financial_pace" AS
WITH days AS (
    SELECT generate_series(
        date_trunc('day', NOW())::date - INTERVAL '90 days',
        date_trunc('day', NOW())::date + INTERVAL '30 days',
        INTERVAL '1 day'
    )::date AS "day"
),
clinic_days AS (
    SELECT c."id" AS "clinicId", d."day"
    FROM "Clinic" c
    CROSS JOIN days d
    WHERE c."active" = true
),
collected AS (
    SELECT
        p."clinicId",
        date_trunc('day', p."paidAt")::date AS "day",
        SUM(p."amount")::bigint AS "revenueCollectedTiins"
    FROM "Payment" p
    WHERE p."status"  = 'PAID'
      AND p."paidAt" IS NOT NULL
    GROUP BY p."clinicId", date_trunc('day', p."paidAt")::date
),
scheduled AS (
    SELECT
        a."clinicId",
        date_trunc('day', a."date")::date AS "day",
        SUM(CASE
            WHEN a."status" <> 'CANCELLED'
            THEN COALESCE(a."priceFinal", COALESCE(a."priceService", 0) - COALESCE(a."discountAmount", 0))
            ELSE 0
        END)::bigint AS "revenueScheduledTiins",
        SUM(CASE
            WHEN a."status" = 'NO_SHOW'
            THEN COALESCE(a."priceFinal", COALESCE(a."priceService", 0) - COALESCE(a."discountAmount", 0))
            ELSE 0
        END)::bigint AS "noShowLossTiins"
    FROM "Appointment" a
    JOIN "Patient" pt
        ON pt."id" = a."patientId"
       AND pt."deletedAt" IS NULL
    GROUP BY a."clinicId", date_trunc('day', a."date")::date
)
SELECT
    cd."clinicId",
    cd."day",
    COALESCE(c."revenueCollectedTiins", 0)::bigint AS "revenueCollectedTiins",
    COALESCE(s."revenueScheduledTiins", 0)::bigint AS "revenueScheduledTiins",
    COALESCE(s."noShowLossTiins",       0)::bigint AS "noShowLossTiins"
FROM clinic_days cd
LEFT JOIN collected c
    ON c."clinicId" = cd."clinicId"
   AND c."day"      = cd."day"
LEFT JOIN scheduled s
    ON s."clinicId" = cd."clinicId"
   AND s."day"      = cd."day"
WITH NO DATA;

CREATE UNIQUE INDEX "mv_financial_pace_pk_idx"
    ON "mv_financial_pace" ("clinicId", "day");

-- ─────────────────────────────────────────────────────────────────────────────
-- mv_schedule_heatmap — doctor schedule load (last 90 days).
--
-- Restricted to last 90 days because heatmap relevance falls off fast — older
-- weekday/hour patterns drift as schedules change. Available-slot count is
-- approximated as appointmentCount: there is no booking-attempt event log to
-- compute "free vs. taken" precisely. W3/W4 may add a slot-attempt table; for
-- now this column equals appointmentCount and the dashboard label notes it.
-- (Could be refined against DoctorSchedule later — that table records weekly
-- working hours, not concrete slots, so it's still an approximation.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW "mv_schedule_heatmap" AS
SELECT
    a."clinicId",
    a."doctorId",
    EXTRACT(ISODOW FROM a."date")::int AS "dayOfWeek",
    EXTRACT(HOUR   FROM a."date")::int AS "hour",
    COUNT(*)::bigint                   AS "appointmentCount",
    COUNT(*)::bigint                   AS "availableSlotCount"
FROM "Appointment" a
JOIN "Patient" p
    ON p."id" = a."patientId"
   AND p."deletedAt" IS NULL
WHERE a."date" >= NOW() - INTERVAL '90 days'
  AND a."status" <> 'CANCELLED'
GROUP BY a."clinicId", a."doctorId",
         EXTRACT(ISODOW FROM a."date"),
         EXTRACT(HOUR   FROM a."date")
WITH NO DATA;

CREATE UNIQUE INDEX "mv_schedule_heatmap_pk_idx"
    ON "mv_schedule_heatmap" ("clinicId", "doctorId", "dayOfWeek", "hour");
