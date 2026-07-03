-- Per-doctor waiting-room TV screen (`/tv/d/<token>`).
-- Additive: nullable column + unique index; existing doctors are backfilled
-- with a random token so every doctor has a working TV link immediately.
ALTER TABLE "Doctor" ADD COLUMN "tvToken" TEXT;

-- gen_random_uuid() is built into PostgreSQL 13+ (no pgcrypto needed).
-- Two concatenated UUIDs, hyphens stripped → 64 hex chars, ample entropy.
UPDATE "Doctor"
SET "tvToken" = replace(gen_random_uuid()::text, '-', '')
WHERE "tvToken" IS NULL;

CREATE UNIQUE INDEX "Doctor_tvToken_key" ON "Doctor"("tvToken");
