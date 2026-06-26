-- Variant C — immutable ticket sequence. `queueOrder` is mutable (the reception
-- drag-reorder renumbers it), which churns the patient-facing ticket number on
-- every reorder. `ticketSeq` is frozen at allocation and is the sole source for
-- the printed/QR ticket number, so a reorder no longer reassigns ticket codes.
-- Backfill existing rows from their current queueOrder so already-issued tickets
-- keep their number.
ALTER TABLE "Appointment" ADD COLUMN "ticketSeq" INTEGER;
UPDATE "Appointment" SET "ticketSeq" = "queueOrder" WHERE "queueOrder" IS NOT NULL;
