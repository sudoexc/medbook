/**
 * «Записать на время» after a lost answer. The booking POST can commit on
 * the server while the iPad, walking out of the Wi-Fi, never hears back.
 * Pressing «Записать» again would then meet the patient's own new visit in
 * that slot (409 doctor_busy), offer «Выбрать другое время» and book him a
 * second time. The booking route has no per-patient guard (the walk-in route
 * has one), so the tablet checks first: is there already a visit of this
 * patient with this doctor at that day and time?
 *
 * Pure: shared by the page and the unit tests.
 */
import { tashkentDateOf, tashkentDayWindow, tashkentPartsOf } from "@/lib/tashkent-time";

import type { UnsureBooking } from "./flow";

/** The fields of a GET /api/crm/appointments row the check reads. */
export type ListedAppointment = {
  id: string;
  patientId: string;
  doctorId: string;
  /** The visit's start, ISO. */
  date: string;
  time: string | null;
  status: string;
  medicalCaseId?: string | null;
};

/** The list query that holds the visit, if it landed: that patient, that doctor, that day. */
export function landedBookingQuery(unsure: UnsureBooking): string {
  const { from, to } = tashkentDayWindow(unsure.day);
  return new URLSearchParams({
    patientId: unsure.patientId,
    doctorId: unsure.doctorId,
    from: from.toISOString(),
    to: to.toISOString(),
    limit: "50",
  }).toString();
}

function hhmm(iso: string): string {
  const p = tashkentPartsOf(iso);
  return `${String(p.hours).padStart(2, "0")}:${String(p.minutes).padStart(2, "0")}`;
}

/** The visit the lost POST created, or null when it never landed. */
export function findLandedBooking(
  rows: ReadonlyArray<ListedAppointment>,
  unsure: UnsureBooking,
): ListedAppointment | null {
  return (
    rows.find(
      (r) =>
        r.patientId === unsure.patientId &&
        r.doctorId === unsure.doctorId &&
        r.status !== "CANCELLED" &&
        tashkentDateOf(r.date) === unsure.day &&
        (r.time || hhmm(r.date)) === unsure.time,
    ) ?? null
  );
}

/**
 * Answers after which the booking may still have been saved: the gateway
 * gave up waiting for the app (502, 504), not the app saying no. Any other
 * status is the route's own answer and is read as such.
 */
export function isUnsureStatus(status: number): boolean {
  return status === 502 || status === 504;
}
