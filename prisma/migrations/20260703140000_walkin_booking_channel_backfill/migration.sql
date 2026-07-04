-- Two-lanes data fix (docs/TZ-two-lanes.md): the CRM «Новая запись» dialog
-- used to default channel to WALKIN, minting slot bookings that the two-lanes
-- model treats as live-queue rows (invisible in «Записи», exempt from every
-- overlap check, absent from the TV). Dialog rows are distinguishable from
-- genuine walk-ins by their queue fields: registerWalkin always allocates
-- queueOrder/ticketSeq + stamps queuedAt at creation; dialog bookings have
-- none until check-in.
--
-- Flip them to PHONE so they rejoin the schedule lane. Guarded: a row whose
-- window collides with an existing schedule-lane booking (a double-book that
-- slipped through while the row was overlap-exempt) is left as-is — flipping
-- it would violate the restored EXCLUDE constraints; reception re-slots those
-- manually via the drawer.
UPDATE "Appointment" a
SET "channel" = 'PHONE'
WHERE a."channel" = 'WALKIN'
  AND a."queuedAt" IS NULL
  AND a."ticketSeq" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Appointment" b
    WHERE b."id" <> a."id"
      AND b."doctorId" = a."doctorId"
      AND b."status" NOT IN ('CANCELLED', 'NO_SHOW')
      AND b."channel" <> 'WALKIN'
      AND tsrange(b."date", b."endDate", '[)') && tsrange(a."date", a."endDate", '[)')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Appointment" c
    WHERE c."id" <> a."id"
      AND c."cabinetId" = a."cabinetId"
      AND c."cabinetId" IS NOT NULL
      AND c."status" NOT IN ('CANCELLED', 'NO_SHOW')
      AND c."channel" <> 'WALKIN'
      AND tsrange(c."date", c."endDate", '[)') && tsrange(a."date", a."endDate", '[)')
  );
