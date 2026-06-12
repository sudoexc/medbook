-- Wave 3c — «Я на месте» self check-in idempotency anchor.
ALTER TABLE "Appointment" ADD COLUMN "arrivedAt" TIMESTAMP(3);
