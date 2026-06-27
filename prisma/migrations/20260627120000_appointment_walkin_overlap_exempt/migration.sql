-- Walk-ins are order-based, not slot-based: `registerWalkin` stamps a
-- `[now, now+durationMin)` window purely so the row sorts and shows an ETA,
-- NOT to reserve a calendar slot. The two EXCLUDE constraints added in
-- 20260429_appointment_no_overlap took that window literally and rejected a
-- walk-in whenever its `[now, now+30)` range overlapped ANY non-cancelled row
-- on the same doctor/cabinet — a second concurrent walk-in, or just a nearby
-- scheduled booking. Result: HTTP 500 ("conflicting key value violates
-- exclusion constraint Appointment_cabinet_no_overlap") and an unusable live
-- walk-in queue (a doctor with any booking in the next 30 min, or two walk-ins
-- at once, could not be queued).
--
-- Fix: exempt WALKIN rows from both overlap constraints. They neither conflict
-- with others nor are blocked by others on the slot axis — overlap detection
-- only makes sense for calendar bookings. Scheduled channels (PHONE/TELEGRAM/
-- WEBSITE/KIOSK) keep the original double-booking protection unchanged.
--
-- This only loosens the predicate, so every row that satisfied the old
-- constraint still satisfies the new one — no cleanup pass is required and the
-- recreate cannot fail on existing data.

ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_doctor_no_overlap";
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_doctor_no_overlap"
  EXCLUDE USING gist (
    "doctorId" WITH =,
    tsrange("date", "endDate", '[)') WITH &&
  ) WHERE (
    "status" NOT IN ('CANCELLED', 'NO_SHOW')
    AND "channel" <> 'WALKIN'::"ChannelType"
  );

ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_cabinet_no_overlap";
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_cabinet_no_overlap"
  EXCLUDE USING gist (
    "cabinetId" WITH =,
    tsrange("date", "endDate", '[)') WITH &&
  ) WHERE (
    "status" NOT IN ('CANCELLED', 'NO_SHOW')
    AND "cabinetId" IS NOT NULL
    AND "channel" <> 'WALKIN'::"ChannelType"
  );
