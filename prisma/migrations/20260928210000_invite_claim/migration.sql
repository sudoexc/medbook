-- Audit PT-04: opening a Telegram invite no longer links the card by itself.
-- The account that opened it is recorded here until it proves the phone.

-- AlterTable
ALTER TABLE "TelegramInviteToken" ADD COLUMN     "claimTelegramId" TEXT,
ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TelegramInviteToken_clinicId_claimTelegramId_idx" ON "TelegramInviteToken"("clinicId", "claimTelegramId");
