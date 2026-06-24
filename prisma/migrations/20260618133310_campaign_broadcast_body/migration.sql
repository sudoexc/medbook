-- Broadcast (рассылка): inline message body for ad-hoc campaigns that are not
-- driven by a saved NotificationTemplate. NULL for existing template-based
-- (dormant reactivation) campaigns.
ALTER TABLE "Campaign" ADD COLUMN "body" TEXT;
