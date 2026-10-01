-- Analytics materialized views on the clinic's (Tashkent) calendar
-- (audit AN-24, AN-25).
--
-- `Appointment.date` and `Payment.paidAt` are TIMESTAMP(3) columns holding
-- UTC. The views bucketed them with bare EXTRACT / date_trunc, i.e. by UTC
-- hour, day and month: the heatmap drew a 09:00 clinic day in the 04 to 13
-- columns, a payment taken at 02:00 Tashkent landed on the previous day,
-- and a visit on the 1st before 05:00 counted in the previous month. Every
-- bucket now goes through `(col AT TIME ZONE 'UTC') AT TIME ZONE
-- 'Asia/Tashkent'`, the Tashkent wall clock.
--
--   mv_schedule_heatmap    dropped: its «свободно» was COUNT(*), the visit
--                          count itself. The heatmap is counted live from
--                          Appointment, DoctorSchedule and DoctorTimeOff
--                          (schedule-heatmap-resolver.ts).
--   mv_doctor_performance  month = Tashkent month.
--   mv_cohort_retention    cohort and visit months = Tashkent months.
--   mv_financial_pace      day = Tashkent day, the window anchored on the
--                          Tashkent today, plus "refreshedAt" (NOW() at
--                          REFRESH time) so the dashboard can say when its
--                          numbers are from instead of the request time.
--
-- Output shapes are unchanged apart from the added column: month and day
-- values are still naive timestamps / dates the resolvers read with UTC
-- getters. Re-created WITH NO DATA like the originals; the analytics
-- worker's boot refresh (or POST /api/crm/analytics/refresh) fills them,
-- detecting the unpopulated views and using a plain REFRESH once.

DROP MATERIALIZED VIEW IF EXISTS "mv_schedule_heatmap";

DROP MATERIALIZED VIEW IF EXISTS "mv_doctor_performance";
CREATE MATERIALIZED VIEW "mv_doctor_performance" AS
WITH ordered AS (
    SELECT
        a."clinicId",
        a."doctorId",
        a."patientId",
        a."status",
        a."date",
        date_trunc('month', ((a."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')) AS "month",
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
        date_trunc('month', ((a."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')) AS "month",
        AVG(r."score")::float AS "npsAvg",
        COUNT(*)::bigint     AS "npsCount"
    FROM "PatientReview" r
    JOIN "Appointment" a
        ON a."id" = r."appointmentId"
    WHERE r."doctorId" IS NOT NULL
      AND r."appointmentId" IS NOT NULL
    GROUP BY r."clinicId", r."doctorId", date_trunc('month', ((a."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'))
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
-- covers every row exactly once: clinicId+doctorId+month is the natural key.
CREATE UNIQUE INDEX "mv_doctor_performance_pk_idx"
    ON "mv_doctor_performance" ("clinicId", "doctorId", "month");
CREATE INDEX "mv_doctor_performance_clinic_month_idx"
    ON "mv_doctor_performance" ("clinicId", "month" DESC);

DROP MATERIALIZED VIEW IF EXISTS "mv_cohort_retention";
CREATE MATERIALIZED VIEW "mv_cohort_retention" AS
WITH first_visit AS (
    SELECT
        a."clinicId",
        a."patientId",
        date_trunc('month', MIN(((a."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'))) AS "cohortMonth"
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
        date_trunc('month', ((a."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')) AS "visitMonth"
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

DROP MATERIALIZED VIEW IF EXISTS "mv_financial_pace";
CREATE MATERIALIZED VIEW "mv_financial_pace" AS
WITH today AS (
    SELECT (NOW() AT TIME ZONE 'Asia/Tashkent')::date AS "day"
),
days AS (
    SELECT generate_series(
        t."day" - INTERVAL '90 days',
        t."day" + INTERVAL '30 days',
        INTERVAL '1 day'
    )::date AS "day"
    FROM today t
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
        ((p."paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::date AS "day",
        SUM(p."amount")::bigint AS "revenueCollectedTiins"
    FROM "Payment" p
    WHERE p."status"  = 'PAID'
      AND p."paidAt" IS NOT NULL
    GROUP BY 1, 2
),
scheduled AS (
    SELECT
        a."clinicId",
        ((a."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::date AS "day",
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
    GROUP BY 1, 2
)
SELECT
    cd."clinicId",
    cd."day",
    COALESCE(c."revenueCollectedTiins", 0)::bigint AS "revenueCollectedTiins",
    COALESCE(s."revenueScheduledTiins", 0)::bigint AS "revenueScheduledTiins",
    COALESCE(s."noShowLossTiins",       0)::bigint AS "noShowLossTiins",
    -- Evaluated at REFRESH time: when these numbers were computed.
    NOW() AS "refreshedAt"
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
