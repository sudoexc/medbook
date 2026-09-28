/**
 * Recognise a write refused by the appointment EXCLUDE constraints
 * (`Appointment_doctor_no_overlap` / `Appointment_cabinet_no_overlap`,
 * Postgres 23P01).
 *
 * The constraints are the last word on overlaps: `detectConflicts` reads
 * before the write, and a booking that takes the slot in between only shows
 * up as this error. Routes turn it into a 409 `doctor_busy` instead of the
 * generic 500 the api-handler answers for an unknown throw (audit AP-06).
 *
 * The Prisma 7 pg adapter surfaces the SQLSTATE as `originalCode`, sometimes
 * on a wrapped `cause`, and the message names the constraint; all of them
 * are checked, like the booking kernel does (`bookAppointment`).
 */
const OVERLAP_CODE = "23P01";
const OVERLAP_MESSAGE_HINTS = [
  "exclusion constraint",
  "Appointment_doctor_no_overlap",
  "Appointment_cabinet_no_overlap",
];

type ErrorLike = {
  code?: unknown;
  originalCode?: unknown;
  message?: unknown;
  cause?: unknown;
  meta?: unknown;
};

function matches(e: ErrorLike): boolean {
  if (e.code === OVERLAP_CODE || e.originalCode === OVERLAP_CODE) return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return OVERLAP_MESSAGE_HINTS.some((hint) => msg.includes(hint));
}

export function isSlotOverlapViolation(e: unknown): boolean {
  // Walk a short cause chain: adapter errors arrive wrapped by the client.
  let cur: unknown = e;
  for (let depth = 0; depth < 4 && cur && typeof cur === "object"; depth++) {
    const errLike = cur as ErrorLike;
    if (matches(errLike)) return true;
    const meta = errLike.meta as { driverAdapterError?: unknown } | undefined;
    cur = errLike.cause ?? meta?.driverAdapterError;
  }
  return false;
}
