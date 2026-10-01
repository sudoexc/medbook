-- Audit DC-10: a doctor's own read marker on a thread he does not own, so
-- opening it no longer zeroes the front desk's shared unreadCount. New
-- table only; no existing row changes.

-- CreateTable
CREATE TABLE "ConversationRead" (
    "clinicId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationRead_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateIndex
CREATE INDEX "ConversationRead_clinicId_userId_idx" ON "ConversationRead"("clinicId", "userId");

-- AddForeignKey
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
