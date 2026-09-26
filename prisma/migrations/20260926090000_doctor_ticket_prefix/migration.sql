-- Audit Q-12: a stored, clinic-unique letter for each doctor's queue tickets.
-- The letter used to be the first character of the doctor's cuid id, which is
-- always "c", so every doctor printed C-001, C-002… at the same time.
-- Existing doctors get their letters from scripts/fix-q12-ticket-prefixes.ts
-- (dry run by default); until then their tickets print the bare number.
-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "ticketPrefix" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_clinicId_ticketPrefix_key" ON "Doctor"("clinicId", "ticketPrefix");
