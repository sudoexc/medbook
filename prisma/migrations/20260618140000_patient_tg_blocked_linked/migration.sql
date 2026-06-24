-- Telegram inbox enrichment (TZ-telegram-section.md).
-- tgBlockedAt: when the patient blocked the bot (my_chat_member / 403 fallback).
-- telegramLinkedAt: when the patient first linked Telegram (trend metric).
ALTER TABLE "Patient" ADD COLUMN "tgBlockedAt" TIMESTAMP(3);
ALTER TABLE "Patient" ADD COLUMN "telegramLinkedAt" TIMESTAMP(3);
