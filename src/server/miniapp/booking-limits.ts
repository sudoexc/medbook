/**
 * Per-patient and per-account limits of the Mini App booking (audit MA-14).
 *
 * One Telegram account could book every free slot of every doctor: the API
 * counted nothing. A patient (the owner or a relative he books for) now
 * holds at most `MINIAPP_MAX_ACTIVE_BOOKINGS` booked visits ahead, one of
 * them per doctor; a visit already under way (queued, on the table) does not
 * count, so the doctor's «запишитесь на контроль» can be booked from the
 * hall. And one account may try only so many bookings in a short window,
 * whoever they are for.
 *
 * Counted per card only, the limits multiplied with the family: every
 * relative the account adds is a new card with a fresh allowance, and
 * unlinking her kept her bookings while freeing the family slot for the
 * next one. So the account as a whole (the owner and every linked relative)
 * holds at most `MINIAPP_MAX_ACTIVE_BOOKINGS_PER_ACCOUNT` Mini App bookings
 * ahead, and a relative who still holds some cannot be unlinked
 * (`hasMiniAppBookingsAhead`), so the count cannot be laundered.
 *
 * The counts run inside the booking transaction (`BookInput.guard`), so two
 * racing taps cannot both pass them.
 */
import type { Prisma } from "@/generated/prisma/client";
import { rateLimit } from "@/lib/rate-limit";
import {
  MINIAPP_MAX_ACTIVE_BOOKINGS,
  MINIAPP_MAX_ACTIVE_BOOKINGS_PER_ACCOUNT,
  MINIAPP_MAX_ACTIVE_BOOKINGS_PER_DOCTOR,
} from "@/lib/appointments/patient-booking";
import type { BookGuardRefusal, BookTx } from "@/server/appointments/book";
import { getFamilyAllowedPatientIds } from "@/server/miniapp/active-patient";
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

/** A booked visit still ahead; a live-queue ticket is not a booking. */
function bookedAheadWhere(now: Date): Prisma.AppointmentWhereInput {
  return {
    // A live-queue ticket is not a booking and reserves no slot.
    channel: { not: "WALKIN" },
    AND: [
      miniAppAppointmentScopeWhere("upcoming", now),
      { status: { in: [...NOT_ATTENDED] } },
    ],
  };
}

/**
 * A booking made in the Mini App and still ahead. TELEGRAM is written by the
 * Mini App booking alone, so a visit reception booked by phone never eats
 * the account's online allowance.
 */
function miniAppBookingAheadWhere(now: Date): Prisma.AppointmentWhereInput {
  return { ...bookedAheadWhere(now), channel: "TELEGRAM" };
}

export async function miniAppBookingLimitRefusal(
  client: BookTx,
  args: {
    clinicId: string;
    /** The card the visit is for: the owner, or the relative he books for. */
    patientId: string;
    /** The Telegram account making the booking. */
    ownerPatientId: string;
    doctorId: string;
    now: Date;
  },
): Promise<BookGuardRefusal | null> {
  const ahead = await client.appointment.findMany({
    where: {
      clinicId: args.clinicId,
      patientId: args.patientId,
      ...bookedAheadWhere(args.now),
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

  // The account: the owner and every relative linked to it, read in the
  // booking's own Serializable transaction, so an unlink racing this booking
  // (also Serializable) makes one of the two retry instead of both passing.
  const accountIds = await getFamilyAllowedPatientIds(
    args.clinicId,
    args.ownerPatientId,
    client,
  );
  // The route checked the link before the transaction; a retry after the
  // unlink won must not book her outside the account's count.
  if (!accountIds.includes(args.patientId)) {
    return { reason: "on_behalf_of_not_linked" };
  }
  const online = await client.appointment.count({
    where: {
      clinicId: args.clinicId,
      patientId: { in: accountIds },
      ...miniAppBookingAheadWhere(args.now),
    },
  });
  if (online >= MINIAPP_MAX_ACTIVE_BOOKINGS_PER_ACCOUNT) {
    return { reason: "booking_limit", limit: "account_total" };
  }
  return null;
}

/**
 * Whether the card still holds Mini App bookings ahead. Unlinking such a
 * relative is refused: her bookings would stay while dropping out of the
 * account's count, and a fresh relative would get the freed allowance.
 */
export async function hasMiniAppBookingsAhead(
  client: BookTx,
  args: { clinicId: string; patientId: string; now: Date },
): Promise<boolean> {
  const n = await client.appointment.count({
    where: {
      clinicId: args.clinicId,
      patientId: args.patientId,
      ...miniAppBookingAheadWhere(args.now),
    },
  });
  return n > 0;
}
