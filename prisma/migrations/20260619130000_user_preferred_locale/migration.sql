-- Staff UI language preference, persisted server-side (PATCH /api/me).
-- Idempotent so re-running on an already-migrated DB is a no-op.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preferredLocale" TEXT NOT NULL DEFAULT 'ru';
