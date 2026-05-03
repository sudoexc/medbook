-- AlterTable: add an optional client-supplied idempotency key, unique per clinic.
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;

-- Postgres treats NULLs as distinct in unique indexes, so multiple rows
-- without an idempotency key per clinic remain allowed. Once a non-null
-- key is provided, (clinicId, idempotencyKey) must be unique so a network
-- retry with the same key returns the original row instead of creating a
-- duplicate.
CREATE UNIQUE INDEX "Payment_clinicId_idempotencyKey_key"
  ON "Payment" ("clinicId", "idempotencyKey");
