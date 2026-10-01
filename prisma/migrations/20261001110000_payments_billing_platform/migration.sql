-- Payments, invoices and platform subscriptions (audit AN-11, AN-12, G5-02).
--
--   Invoice.number        unique per clinic instead of globally: each clinic
--                         numbers its own series from INV-YYYY-0001, so the
--                         second clinic's first invoice no longer hits the
--                         first clinic's number (AN-12). Every existing row
--                         was globally unique, so it is unique per clinic too.
--   Subscription.graceEndsAt
--                         when a PAST_DUE grace period runs out; the
--                         trial-expiry scheduler cancels the subscription
--                         after it (G5-02). Nullable, no backfill: the
--                         scheduler stamps it on PAST_DUE rows that have none.
--   Payment.refundedAt    the day a refund was given back (AN-11). Revenue
--                         is counted on paidAt and the refund subtracted on
--                         refundedAt, so a refund lowers the day it happened
--                         instead of erasing the day the money came in.

-- DropIndex
DROP INDEX "Invoice_number_key";

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "graceEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_clinicId_number_key" ON "Invoice"("clinicId", "number");

-- CreateIndex
CREATE INDEX "Payment_clinicId_refundedAt_idx" ON "Payment"("clinicId", "refundedAt");

-- Existing refunds keep the effect they had: a REFUNDED payment used to drop
-- out of revenue entirely. It now counts on its paid day and its refund is
-- subtracted, so the refund is dated on that same day (net zero there, as
-- before) and a fully refunded row carries its whole amount as refunded.
-- Idempotent: only rows without a refund amount / date are touched.
UPDATE "Payment"
   SET "refundedAmount" = "amount"
 WHERE "status" = 'REFUNDED'
   AND "refundedAmount" = 0;

UPDATE "Payment"
   SET "refundedAt" = COALESCE("paidAt", "updatedAt")
 WHERE "refundedAmount" > 0
   AND "refundedAt" IS NULL;

-- mv_financial_pace: «собрано» is now net of refunds, on the same rule as the
-- live analytics (src/server/analytics/net-revenue.ts): PAID and REFUNDED
-- payments count on their Tashkent paid day, refunds are subtracted on their
-- Tashkent refund day. Otherwise identical to 20261001100000. Re-created WITH
-- NO DATA; the analytics worker detects the unpopulated view and refreshes it.
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
money_moves AS (
    SELECT
        p."clinicId",
        ((p."paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::date AS "day",
        p."amount"::bigint AS "tiins"
    FROM "Payment" p
    WHERE p."status" IN ('PAID', 'REFUNDED')
      AND p."paidAt" IS NOT NULL
    UNION ALL
    SELECT
        p."clinicId",
        ((p."refundedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::date AS "day",
        -p."refundedAmount"::bigint AS "tiins"
    FROM "Payment" p
    WHERE p."status" IN ('PAID', 'REFUNDED')
      AND p."refundedAmount" > 0
      AND p."refundedAt" IS NOT NULL
),
collected AS (
    SELECT
        m."clinicId",
        m."day",
        SUM(m."tiins")::bigint AS "revenueCollectedTiins"
    FROM money_moves m
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
