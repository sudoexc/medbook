-- Live queue: per-doctor cap on pre-bookable slots/day (grid steps every 20m).
ALTER TABLE "Doctor" ADD COLUMN "maxBookableSlotsPerDay" INTEGER NOT NULL DEFAULT 3;
