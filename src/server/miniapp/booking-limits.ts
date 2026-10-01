/**
 * Per-patient limits of the Mini App booking (audit MA-14).
 *
 * One Telegram account could book every free slot of every doctor: the API
 * counted nothing. A patient (the owner or a relative he books for) now
 * holds at most `MINIAPP_MAX_ACTIVE_BOOKINGS` booked visits ahead, one of
 * them per doctor; a visit already under way (queued, on the table) does not
 * count, so the doctor's «запишитесь на контроль» can be booked from the
 * hall. And one account may try only so many bookings in a short window,
 * whoever they are for.
 *
 * The count runs inside the booking transaction (`BookInput.guard`), so two
 * racing taps cannot both pass it.
 */
import { rateLimit } from "@/lib/rate-limit";
import {
  MINIAPP_MAX_ACTIVE_BOOKINGS,
  MINIAPP_MAX_ACTIVE_BOOKINGS_PER_DOCTOR,
} from "@/lib/appointments/patient-booking";
import type { BookGuardRefusal, BookTx } from "@/server/appointments/book";
import { miniAppAppointmentScopeWhere } from "@/server/miniapp/appointment-scope";

/** Booking attempts one Telegram account may make per window. */
export const MINIAPP_BOOKING_ATTEMPTS = { limit: 10, windowMs: 10 * 60_000 } as const;

const RATE_STORE = "miniapp-booking";

/** Counts one booking attempt of the account; false once over the budget. */
export function allowMiniAppBookingAttempt(clinicId: string, ownerPatientId: string): boolean {
  return rateLimit(
    `${clinicId}:${ownerPatientId}`,
    MINIAPP_BOOKING_ATTEMPTS.limit,
    MINIAPP_BOOKING_ATTEMPTS.windowMs,
    RATE_STORE,
  );
}

/** Booked visits that still lie ahead of the patient (not yet attended). */
const NOT_ATTENDED = ["BOOKED", "CONFIRMED"] as const;

export async function miniAppBookingLimitRefusal(
  client: BookTx,
  args: { clinicId: string; patientId: string; doctorId: string; now: Date },
): Promise<BookGuardRefusal | null> {
  const ahead = await client.appointment.findMany({
    where: {
      clinicId: args.clinicId,
      patientId: args.patientId,
      // A live-queue ticket is not a booking and reserves no slot.
      channel: { not: "WALKIN" },
      AND: [
        miniAppAppointmentScopeWhere("upcoming", args.now),
        { status: { in: [...NOT_ATTENDED] } },
      ],
    },
    select: { doctorId: true },
  });
  const withDoctor = ahead.filter((a) => a.doctorId === args.doctorId).length;
  if (withDoctor >= MINIAPP_MAX_ACTIVE_BOOKINGS_PER_DOCTOR) {
    return { reason: "booking_limit", limit: "patient_doctor" };
  }
  if (ahead.length >= MINIAPP_MAX_ACTIVE_BOOKINGS) {
    return { reason: "booking_limit", limit: "patient_total" };
  }
  return null;
}
