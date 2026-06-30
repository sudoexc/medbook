-- D-1: add an in-flight "SENDING" state to NotificationStatus so the send
-- worker can atomically claim a QUEUED row (QUEUED→SENDING) before dispatch
-- and prevent double-send under concurrent workers / duplicate jobs.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'SENDING' AFTER 'QUEUED';
