-- Phase 19 Wave 3 — billing UI + invoice + Click/Payme stubs.
--
-- The Wave 1 Invoice table is sufficient for the new flows. The only
-- schema change is a single `pendingPlanId` column on `Subscription`:
-- set when an upgrade is initiated (DRAFT Invoice minted), cleared when
-- the invoice transitions to PAID and the swap into `planId` happens.
--
-- No new indexes — the column is read together with the subscription
-- row and never queried in isolation.

ALTER TABLE "Subscription" ADD COLUMN "pendingPlanId" TEXT;
