-- Appointment.ticketCode — human-readable, globally-unique short code shown to
-- the patient on the booking confirmation screen and encoded in the QR they
-- present at reception.
--
-- Crockford-style base32 (no 0/1/I/L/O/U): 30 chars × 6 positions ≈ 729M
-- combinations, collisions vanishingly unlikely. Existing appointments are
-- backfilled in-place by a PL/pgSQL block that retries on the very rare
-- collision so the unique index can be added at the end without a fix-up
-- pass.

ALTER TABLE "Appointment" ADD COLUMN "ticketCode" TEXT;

DO $$
DECLARE
  rec RECORD;
  code TEXT;
  alphabet TEXT := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  attempt INT;
BEGIN
  FOR rec IN SELECT id FROM "Appointment" WHERE "ticketCode" IS NULL LOOP
    attempt := 0;
    LOOP
      attempt := attempt + 1;
      code := '';
      FOR i IN 1..6 LOOP
        code := code || substr(alphabet, floor(random() * 30 + 1)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Appointment" WHERE "ticketCode" = code);
      IF attempt > 8 THEN
        RAISE EXCEPTION 'ticket_code_backfill_exhausted for appointment %', rec.id;
      END IF;
    END LOOP;
    UPDATE "Appointment" SET "ticketCode" = code WHERE id = rec.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX "Appointment_ticketCode_key" ON "Appointment"("ticketCode");
