-- Ф7 (TZ-smart-constructor) — динамика состояния vs прошлый визит.
-- IMPROVED | STABLE | WORSE (string, не enum) + свободный комментарий.

ALTER TABLE "VisitNote" ADD COLUMN IF NOT EXISTS "dynamics" TEXT;
ALTER TABLE "VisitNote" ADD COLUMN IF NOT EXISTS "dynamicsNote" TEXT;
