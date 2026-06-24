-- Document signature capture for the "ожидают подписи" filter.
-- NULL = awaiting signature; stamped by POST /api/crm/documents/[id]/sign.
ALTER TABLE "Document" ADD COLUMN "signedAt" TIMESTAMP(3);
