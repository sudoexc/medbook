/**
 * Shared schedule-status mapper for the doctor surface.
 *
 * `/api/crm/doctors/me/today` and `/api/crm/doctors/me/schedule` both
 * project Appointment.status into a smaller UI-facing enum. Keeping the
 * mapping in one place stops the two endpoints from drifting on edge
 * cases (NO_SHOW being the historical example — it used to fall into
 * "done" alongside COMPLETED, so a patient who never showed looked
 * identical to a completed visit in the agenda).
 */
export type DoctorScheduleStatus =
  | "in_progress"
  | "upcoming"
  | "done"
  | "no_show"
  | "cancelled";

export function scheduleStatusOf(
  appointmentStatus: string,
): DoctorScheduleStatus {
  // Only a visit the doctor has actually started is «Идёт приём». WAITING =
  // patient has arrived and is queued, NOT being seen — it must NOT render as
  // in_progress: that offers a «Завершить» the server rejects (WAITING→
  // COMPLETED is invalid) and makes a whole queue look like simultaneous
  // visits, breaking the one-visit-at-a-time rule. WAITING falls through to
  // "upcoming" so the row offers «Начать», gated by the single-active guard.
  if (appointmentStatus === "IN_PROGRESS") {
    return "in_progress";
  }
  if (appointmentStatus === "COMPLETED" || appointmentStatus === "SKIPPED") {
    // SKIPPED is rare and doctor-initiated ("I'm not seeing this patient");
    // grouping with COMPLETED keeps the visual signal "this slot is closed".
    return "done";
  }
  if (appointmentStatus === "NO_SHOW") return "no_show";
  if (appointmentStatus === "CANCELLED") return "cancelled";
  return "upcoming";
}
