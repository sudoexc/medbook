-- Ф5 (TZ-smart-constructor) — public QR verification for documents.
-- Hand-written idempotent migration (house rule: `prisma migrate dev` is
-- broken locally; applied via `prisma db execute` + `migrate resolve`).

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "verifyToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Document_verifyToken_key"
  ON "Document"("verifyToken");
