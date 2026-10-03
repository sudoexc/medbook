/**
 * The tablet's refusals in words. The walk-in, patient and booking routes
 * answer with a status and an `{ error, reason }` envelope; the receptionist
 * must read what happened and what to do, never «HTTP 409».
 *
 * The phone-owner question (409 `phone_owner_mismatch`) and the plan limit
 * (402) are read with their own shared helpers (`readPhoneOwnerMismatch`,
 * `readPlanLimit`) before this one runs.
 *
 * Pure: shared by the page and the unit tests.
 */
import { readPlanLimit, type PlanLimitQuota } from "@/lib/plan-limit";

/** Slot refusals of the booking route, worded in `appointments.drawer.conflict`. */
export const BOOKING_CONFLICT_REASONS = [
  "doctor_busy",
  "cabinet_busy",
  "doctor_time_off",
  "outside_schedule",
  "in_past",
] as const;

export type BookingConflictReason = (typeof BOOKING_CONFLICT_REASONS)[number];

/** Refusals worded in `receptionTablet.confirm.errors`. */
export type KnownFailure =
  | "bad_phone"
  | "doctor_not_found"
  | "patient_not_found"
  | "service_not_offered"
  | "forbidden";

export type WriteFailure =
  | { kind: "slot"; reason: BookingConflictReason; until?: string }
  | { kind: "known"; code: KnownFailure }
  | { kind: "planLimit"; quota: PlanLimitQuota; max: number }
  | { kind: "failed" };

/** The thrown form, so a mutation's `onError` can tell it from a network error. */
export class TabletWriteError extends Error {
  constructor(readonly failure: WriteFailure) {
    super(`tablet_write:${failure.kind}`);
    this.name = "TabletWriteError";
  }
}

const KNOWN_ALIASES: Record<string, KnownFailure> = {
  bad_phone: "bad_phone",
  // POST /api/crm/patients words a refused number this way.
  invalid_phone: "bad_phone",
  doctor_not_found: "doctor_not_found",
  doctor_inactive: "doctor_not_found",
  patient_not_found: "patient_not_found",
  service_not_offered: "service_not_offered",
};

export function readWriteFailure(status: number, body: unknown): WriteFailure {
  const limit = readPlanLimit(status, body);
  if (limit) return { kind: "planLimit", ...limit };
  const b = (body && typeof body === "object" ? body : {}) as {
    error?: unknown;
    reason?: unknown;
    until?: unknown;
  };
  const reason = typeof b.reason === "string" ? b.reason : "";
  const error = typeof b.error === "string" ? b.error : "";
  if ((BOOKING_CONFLICT_REASONS as readonly string[]).includes(reason)) {
    return {
      kind: "slot",
      reason: reason as BookingConflictReason,
      ...(typeof b.until === "string" ? { until: b.until } : {}),
    };
  }
  const known = KNOWN_ALIASES[reason] ?? KNOWN_ALIASES[error];
  if (known) return { kind: "known", code: known };
  if (status === 403) return { kind: "known", code: "forbidden" };
  return { kind: "failed" };
}

/**
 * A fetch that never got an answer (Wi-Fi dropped as the receptionist
 * walked into the corridor) throws a TypeError; an aborted one, an
 * AbortError. Both mean «no connection», not «the server said no».
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TabletWriteError) return false;
  if (e instanceof TypeError) return true;
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}
