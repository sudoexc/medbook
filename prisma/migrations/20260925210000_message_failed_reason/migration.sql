-- Staff messages that never reached Telegram (audit TG-04).
--
-- A message to a thread the clinic opened from the patient card used to be
-- marked DELIVERED without any send. It is now sent through the Bot API, and
-- when that fails the row is FAILED with a short reason code the chat shows
-- (`tg_blocked`, `no_telegram`, `tg_error`, `not_sent`).

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "failedReason" TEXT;
