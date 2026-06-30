-- Bind each upgrade Invoice to its destination plan so the PAID handler swaps
-- the subscription to the plan that was actually paid for, not to whatever
-- Subscription.pendingPlanId holds at payment time.
ALTER TABLE "Invoice" ADD COLUMN "targetPlanId" TEXT;
