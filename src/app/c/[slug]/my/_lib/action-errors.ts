/**
 * What the patient reads when a booking, a move or a cancel is refused
 * (audit MA-17). The sheets used to `showAlert` the raw error code, so a
 * patient saw «doctor_busy» or «not_editable»; and the booking screen said
 * «слот занят» for every 409, a limit included.
 *
 * Pure: takes the error `useMiniAppFetch` throws (`data` is the JSON body:
 * `{ error, reason?, limit? }`) and the dictionary.
 */
import type { Dict } from "../_components/mini-i18n";
import {
  MINIAPP_BOOKING_HORIZON_DAYS,
  MINIAPP_MAX_ACTIVE_BOOKINGS,
  MINIAPP_MAX_ACTIVE_BOOKINGS_PER_ACCOUNT,
} from "@/lib/appointments/patient-booking";

type ActionError = {
  message?: string;
  data?: { error?: unknown; reason?: unknown; limit?: unknown } | null;
};

export function miniAppActionErrorText(e: unknown, t: Dict): string {
  const err = (e ?? {}) as ActionError;
  const reason = typeof err.data?.reason === "string" ? err.data.reason : null;
  const error = typeof err.data?.error === "string" ? err.data.error : null;
  const code = reason ?? error ?? err.message ?? "";
  switch (code) {
    case "booking_limit":
      if (err.data?.limit === "patient_doctor") return t.book.errorLimitDoctor;
      if (err.data?.limit === "account_total") {
        return t.book.errorLimitAccount.replace(
          "{count}",
          String(MINIAPP_MAX_ACTIVE_BOOKINGS_PER_ACCOUNT),
        );
      }
      return t.book.errorLimitTotal.replace("{count}", String(MINIAPP_MAX_ACTIVE_BOOKINGS));
    case "has_upcoming_bookings":
      return t.family.unlinkHasBookings;
    case "rate_limited":
      return t.book.errorRateLimited;
    case "beyond_horizon":
      return t.book.errorBeyondHorizon.replace("{days}", String(MINIAPP_BOOKING_HORIZON_DAYS));
    case "off_grid":
      return t.book.errorOffGrid;
    case "in_past":
      return t.book.errorPast;
    case "outside_schedule":
    case "doctor_time_off":
      return t.book.errorOutsideHours;
    case "doctor_busy":
    case "cabinet_busy":
      return t.book.errorConflict;
    case "doctor_not_found":
    case "service_not_found":
    case "cabinet_inactive":
      return t.book.errorUnavailable;
    case "not_reschedulable":
      return t.appts.rescheduleArrived;
    case "not_editable":
    case "not_cancellable":
      return t.appts.notEditable;
    case "has_payment":
      return t.appts.paymentLocked;
    default:
      return t.book.errorGeneric;
  }
}
