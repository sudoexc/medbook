-- Wave 5 — manual queue urgency. Higher floats to the top of the waiting
-- list ahead of arrival order; ties fall back to queueOrder (drag order).
ALTER TABLE "Appointment" ADD COLUMN "queuePriority" INTEGER NOT NULL DEFAULT 0;
