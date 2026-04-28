-- Capture Telegram contact identity (first/last name, @username) on the
-- Conversation row so the inbox can show "Joe Smith (@joeuser)" instead of
-- a bare chat_id. Populated on every webhook event (overwriting on change),
-- so renaming or username updates propagate automatically.

ALTER TABLE "Conversation"
  ADD COLUMN "contactFirstName" TEXT,
  ADD COLUMN "contactLastName"  TEXT,
  ADD COLUMN "contactUsername"  TEXT;
