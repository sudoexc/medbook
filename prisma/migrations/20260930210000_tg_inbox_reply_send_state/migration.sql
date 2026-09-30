-- Telegram inbox (audit P4: G6-03, G6-08, TG-17).
--
-- MessageStatus.SENDING: a staff message now leaves through a queue worker
-- instead of the HTTP request (nginx cut slow sends at 60s and operators sent
-- again, the patient got duplicates). The worker claims QUEUED→SENDING before
-- the Telegram call so a duplicate job or the sweep cannot send it twice.
-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE 'SENDING';

-- Conversation.awaitingReplySince: «Неотвеченные» means a patient message
-- no staff reply followed, not «unread» (opening a chat used to drop it from
-- the tab before anyone answered). Nullable: null = nothing waits.
-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "awaitingReplySince" TIMESTAMP(3);

-- Message.origin / notificationSendId: reminders and broadcasts the bot sent
-- are copied into the patient's dialog, once per delivery, so the operator
-- sees what the patient is answering.
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "notificationSendId" TEXT,
ADD COLUMN     "origin" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_notificationSendId_key" ON "Message"("notificationSendId");

-- Backfill: a thread waits for a reply from its oldest patient message after
-- the last staff message that reached Telegram. Bot commands (/start) and the
-- doctor's own dictations never wait, the same rule the webhook applies from
-- now on (src/server/conversations/reply-state.ts).
UPDATE "Conversation" c
SET "awaitingReplySince" = w."firstIn"
FROM (
  SELECT m."conversationId", MIN(m."createdAt") AS "firstIn"
  FROM "Message" m
  WHERE m."direction" = 'IN'
    AND COALESCE(m."body", '') NOT LIKE '/%'
    AND COALESCE(m."body", '') <> '🎤 Диктовка врача'
    AND m."createdAt" > COALESCE(
      (
        SELECT MAX(o."createdAt")
        FROM "Message" o
        WHERE o."conversationId" = m."conversationId"
          AND o."direction" = 'OUT'
          AND o."senderId" IS NOT NULL
          AND o."status" IN ('SENT', 'DELIVERED', 'READ')
      ),
      '-infinity'::timestamp
    )
  GROUP BY m."conversationId"
) w
WHERE c."id" = w."conversationId"
  AND c."awaitingReplySince" IS NULL;
