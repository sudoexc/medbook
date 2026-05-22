-- Patient.lastContactedAt: denormalised most-recent operator contact timestamp.
-- See `bumpPatientLastContact` for the write-side helper that keeps this fresh.
ALTER TABLE "Patient" ADD COLUMN "lastContactedAt" TIMESTAMP(3);
CREATE INDEX "Patient_clinicId_lastContactedAt_idx"
  ON "Patient"("clinicId", "lastContactedAt");

-- Backfill from the four sources that count as a human touch. NotificationSend
-- is deliberately excluded — those are mechanical templates, not contact.
-- For each patient we take the latest timestamp across:
--   1. Call.createdAt           (any direction)
--   2. Message.createdAt         (via Conversation.patientId)
--   3. Communication.createdAt   (manual SMS/email)
--   4. Appointment.completedAt   (or .date for legacy rows where completedAt
--                                 was never stamped, but only for COMPLETED)
UPDATE "Patient" p
SET "lastContactedAt" = src.last_at
FROM (
  SELECT patient_id, MAX(at) AS last_at FROM (
    SELECT "patientId" AS patient_id, "createdAt" AS at FROM "Call"
    UNION ALL
    SELECT c."patientId" AS patient_id, m."createdAt" AS at
      FROM "Message" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE c."patientId" IS NOT NULL
    UNION ALL
    SELECT "patientId" AS patient_id, "createdAt" AS at FROM "Communication"
    UNION ALL
    SELECT "patientId" AS patient_id,
           COALESCE("completedAt", "date") AS at
      FROM "Appointment"
      WHERE "status" = 'COMPLETED'
  ) all_touches
  WHERE patient_id IS NOT NULL
  GROUP BY patient_id
) src
WHERE p.id = src.patient_id;
