-- serveAt EDF — `queuedAt` is the instant a visit joined the live waiting queue.
-- The queue comparator serves walk-ins FIFO by this stamp and scheduled visits at
-- max(slot, queuedAt), so a late booking is treated as a walk-in from arrival and
-- can't jump the patients who actually waited. Backfill the currently-live rows
-- (WAITING / IN_PROGRESS) from the best available arrival signal so today's board
-- keeps a sane order the moment the migration lands.
ALTER TABLE "Appointment" ADD COLUMN "queuedAt" TIMESTAMP(3);
UPDATE "Appointment"
  SET "queuedAt" = COALESCE("startedAt", "arrivedAt", "date")
  WHERE "queueStatus" IN ('WAITING', 'IN_PROGRESS') AND "queuedAt" IS NULL;
