/**
 * «Записать на время» as requests, through the routes the booking dialog
 * uses: POST /api/crm/patients for a new card (the phone-owner rules), then
 * POST /api/crm/appointments (bookAppointment: no past, conflicts,
 * schedule), then the case filing (injected, the dialog's own helper).
 *
 * After a POST that got no answer the visit may exist, so the next try
 * looks it up first (booking-recovery.ts) and never books the patient twice.
 *
 * No React here: the page's mutation calls it, the unit tests call it with a
 * stubbed `fetch`.
 */
import {
  PhoneOwnerMismatchError,
  readPhoneOwnerMismatch,
  type PhoneOwnerAnswer,
} from "@/components/appointments/phone-owner-prompt";

import {
  findLandedBooking,
  isUnsureStatus,
  landedBookingQuery,
  type ListedAppointment,
} from "./booking-recovery";
import { DEFAULT_VISIT_MIN, tashkentNoonIso } from "./doctor-day";
import { BookingUnsureError, readWriteFailure, TabletWriteError } from "./errors";
import type { ChosenPatient, UnsureBooking } from "./flow";

/**
 * No write holds the screen longer than this. While one is out, the flow's
 * «Назад» and «Отмена» are locked (its answer belongs to this patient), so
 * a request the corridor Wi-Fi swallowed must end on its own. The server may
 * still finish it: the walk-in route then hands back the same ticket on the
 * next try, and a booking is looked up before it is tried again.
 */
export const WRITE_TIMEOUT_MS = 40_000;

export function writeSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(WRITE_TIMEOUT_MS)
    : undefined;
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

export type BookInput = {
  patient: ChosenPatient;
  /** An earlier try of this flow that got no answer: looked up first. */
  unsure: UnsureBooking | null;
  /** A card this flow already created (a retry after a taken slot). */
  createdPatientId: string | null;
  doctorId: string;
  serviceId: string | null;
  /** The chosen service's length with this doctor, minutes. */
  serviceMin: number | null;
  day: string;
  time: string;
  phoneOwner?: PhoneOwnerAnswer;
  /** Told as soon as a new card exists, before the booking is tried. */
  onPatientCreated?: (patientId: string) => void;
};

/** What the booking ends with: the visit as it stands on the server. */
export type BookedVisit = {
  id: string;
  patientId: string;
  doctorId: string;
  day: string;
  time: string;
  /** Found by the check after a lost answer, not booked just now. */
  recovered: boolean;
};

/**
 * Did the unanswered POST create the visit after all? Throws
 * `BookingUnsureError` while that still cannot be told (no connection, the
 * server failing), so the flow keeps checking before any new booking. A
 * refusal of the lookup itself (4xx) cannot be fixed by retrying: the
 * booking is then tried, and the route's slot check still stops an exact
 * double.
 */
export async function lookForLandedBooking(
  unsure: UnsureBooking,
): Promise<ListedAppointment | null> {
  let res: Response;
  try {
    res = await fetch(`/api/crm/appointments?${landedBookingQuery(unsure)}`, {
      credentials: "include",
      signal: writeSignal(),
    });
  } catch {
    throw new BookingUnsureError(unsure);
  }
  if (res.status >= 400 && res.status < 500) return null;
  const j = res.ok ? ((await readJson(res)) as { rows?: ListedAppointment[] } | null) : null;
  if (!j || !Array.isArray(j.rows)) throw new BookingUnsureError(unsure);
  return findLandedBooking(j.rows, unsure);
}

export async function bookVisit(
  v: BookInput,
  deps: {
    /** Files the visit into the patient's case; soft, never throws. */
    fileIntoCase: (appointmentId: string, patientId: string, doctorId: string) => Promise<void>;
  },
): Promise<BookedVisit> {
  if (v.unsure) {
    const landed = await lookForLandedBooking(v.unsure);
    if (landed) {
      if (!landed.medicalCaseId) {
        await deps.fileIntoCase(landed.id, v.unsure.patientId, v.unsure.doctorId);
      }
      return { ...v.unsure, id: landed.id, recovered: true };
    }
  }

  let patientId: string | null = v.patient.kind === "existing" ? v.patient.id : v.createdPatientId;

  if (!patientId && v.patient.kind === "new") {
    const res = await fetch("/api/crm/patients", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal: writeSignal(),
      body: JSON.stringify({
        fullName: v.patient.fullName,
        phone: v.patient.phone,
        ...(v.patient.gender ? { gender: v.patient.gender } : {}),
        // Standing at the desk is how he came, as on the walk-in path.
        source: "WALKIN",
        ...(v.phoneOwner ? { phoneOwner: v.phoneOwner } : {}),
      }),
    });
    const j = (await readJson(res)) as { id?: string; reason?: string; patientId?: string } | null;
    if (!res.ok) {
      const owner = readPhoneOwnerMismatch(res.status, j);
      if (owner) throw new PhoneOwnerMismatchError(owner);
      // The same person already has a card (the name matched, or staff
      // answered «тот же человек»): book into it.
      if (res.status === 409 && j?.reason === "phone_already_exists" && j.patientId) {
        patientId = j.patientId;
      } else {
        throw new TabletWriteError(readWriteFailure(res.status, j));
      }
    } else if (j?.id) {
      patientId = j.id;
    }
    if (!patientId) throw new TabletWriteError({ kind: "failed" });
    v.onPatientCreated?.(patientId);
  }
  if (!patientId) throw new TabletWriteError({ kind: "failed" });

  // From here on a lost answer may hide a saved visit.
  const attempt: UnsureBooking = { patientId, doctorId: v.doctorId, day: v.day, time: v.time };
  let res: Response;
  try {
    res = await fetch("/api/crm/appointments", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal: writeSignal(),
      body: JSON.stringify({
        patientId,
        doctorId: v.doctorId,
        services: v.serviceId ? [{ serviceId: v.serviceId, quantity: 1 }] : [],
        ...(v.serviceId ? { serviceId: v.serviceId } : {}),
        date: tashkentNoonIso(v.day),
        time: v.time,
        // The slot grid sized the block the same way (service length with
        // this doctor, else the grid step).
        durationMin: Math.max(5, v.serviceMin ?? DEFAULT_VISIT_MIN),
        // The booking dialog's desk default; WALKIN is the live lane's.
        channel: "PHONE",
      }),
    });
  } catch {
    throw new BookingUnsureError(attempt);
  }
  if (!res.ok) {
    if (isUnsureStatus(res.status)) throw new BookingUnsureError(attempt);
    throw new TabletWriteError(readWriteFailure(res.status, await readJson(res)));
  }
  // Saved; only the answer's body may still be lost on the way.
  const created = (await readJson(res)) as { id?: string } | null;
  if (!created?.id) throw new BookingUnsureError(attempt);

  await deps.fileIntoCase(created.id, patientId, v.doctorId);
  return { ...attempt, id: created.id, recovered: false };
}
