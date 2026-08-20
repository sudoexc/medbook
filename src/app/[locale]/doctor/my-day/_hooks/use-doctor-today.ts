"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";
import type { AppointmentStatus } from "@/lib/appointment-transitions";
import type { AppEvent } from "@/server/realtime/events";

export type ScheduleType = "consultation" | "repeat" | "reserve" | "break";
export type ScheduleStatus =
  | "in_progress"
  | "upcoming"
  | "done"
  | "no_show"
  | "cancelled";

export type ScheduleEntry = {
  id: string;
  startTime: string;
  patientId: string | null;
  patientName: string | null;
  type: ScheduleType;
  durationMin: number | null;
  status: ScheduleStatus;
  /**
   * Raw Appointment.status. `status` above collapses COMPLETED and SKIPPED
   * into one "done" bucket, but their revert targets differ (IN_PROGRESS vs
   * WAITING) — the row's undo button feeds this into `revertTargetFor`
   * instead of guessing from the collapsed bucket.
   */
  appointmentStatus: AppointmentStatus;
  /** When the doctor pressed «Вызвать пациента». Drives the row CTA. */
  calledAt: string | null;
};

export type PatientTag = "active" | "first_visit" | "vip" | "new";

export type CurrentPatient = {
  appointmentId: string;
  patientId: string;
  /**
   * Raw appointment status — combined with `calledAt` drives which CTA the
   * card shows. The 3-step doctor workflow is:
   *   BOOKED/WAITING + !calledAt  → «Вызвать пациента»
   *   BOOKED/WAITING +  calledAt  → «Начать приём»
   *   IN_PROGRESS                 → «Завершить приём»
   */
  status: AppointmentStatus;
  fullName: string;
  age: number | null;
  birthDate: string | null;
  phone: string;
  avatarUrl: string | null;
  tags: PatientTag[];
  startsAt: string;
  endsAt: string;
  startedAt: string | null;
  calledAt: string | null;
  appointmentSecondsLeft: number;
  complaints: string;
  lastVisit: { date: string; title: string } | null;
  lastDiagnosis: { codes: { code: string; name: string }[] };
};

/**
 * One row of the LIVE lane (walk-ins only — docs/TZ-two-lanes.md), ordered
 * FIFO by the server projection. Bookings never appear here; they live in
 * the schedule cards with their own «Начать» CTA.
 */
export type LiveQueueEntry = {
  appointmentId: string;
  patientFullName: string;
  ticketNumber: string;
  /** 1-based FIFO position within the live lane. */
  position: number;
  etaMinutes: number;
  /** ISO — when the patient joined the queue. Omitted for legacy rows. */
  queuedAt?: string;
};

export type DaySummary = {
  totalAppointments: number;
  consultations: number;
  repeats: number;
  completedCount: number;
  dayPlanPercent: number;
};

/**
 * The /today aggregate is intentionally small: the simplified «Мой день»
 * screen renders only the current-patient card and the live queue. The
 * ScheduleCard reads /doctors/me/schedule via `useDoctorSchedule` instead.
 * Anything added back here is paid for on every SSE-triggered refetch.
 */
export type DoctorToday = {
  /** Doctor row id — used to scope SSE invalidation to this doctor. */
  doctorId: string;
  current: CurrentPatient | null;
  /**
   * True when `current` is the imminent-booking fallback (next booking
   * within 15 min), not a real active visit — the card labels it
   * «Следующая запись» so the doctor knows nothing has started yet.
   */
  currentIsImplicitNext: boolean;
  /** Walk-in FIFO — the live lane, rendered by LiveQueueCard. */
  liveQueue: LiveQueueEntry[];
};

export const doctorTodayKey = ["doctor", "me", "today"] as const;

/**
 * True when an SSE event concerns the given doctor — or can't be ruled out.
 *
 * `appointment.*` / `queue.updated` payloads carry the Doctor row id (see
 * `emitAppointmentChangeViaOutbox` and the walk-in/book/cancel publishers),
 * so most events scope cleanly. The check is deliberately conservative:
 * when our own id isn't known yet (first fetch still in flight) or the
 * payload has no usable `doctorId` (legacy/unscoped publisher), we allow
 * the invalidation — a spare refetch is cheap, a missed update leaves the
 * doctor staring at a stale queue.
 */
export function eventTargetsDoctor(
  event: AppEvent,
  doctorId: string | null | undefined,
): boolean {
  if (!doctorId) return true;
  const payloadDoctorId = (event.payload as { doctorId?: unknown }).doctorId;
  if (typeof payloadDoctorId !== "string" || payloadDoctorId.length === 0) {
    return true;
  }
  return payloadDoctorId === doctorId;
}

/**
 * Backs the current-patient + live-queue cards on /doctor/my-day via a
 * single aggregate fetch.
 *
 * The `select` parameter lets each card subscribe to its own slice — TanStack
 * will only re-render the card whose slice actually changed.
 *
 * `useLiveQueryInvalidation` debounces with a 400ms coalesce inside, so a
 * burst of events fires at most one refetch.
 */
export function useDoctorToday<TSelected = DoctorToday>(
  select?: (data: DoctorToday) => TSelected,
) {
  const qc = useQueryClient();
  const query = useQuery<DoctorToday, Error, TSelected>({
    queryKey: doctorTodayKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/today", {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        throw new Error(`doctor-today: ${res.status}`);
      }
      return (await res.json()) as DoctorToday;
    },
    select,
    staleTime: 15_000,
  });

  useLiveQueryInvalidation({
    // Scoped to what the screen actually renders — the current patient and
    // the live queue. `queue.updated` was missing, so a reception-side drag
    // or priority bump never reached the doctor: positions and «ждёт N мин»
    // sat stale until an unrelated appointment event happened to land.
    events: [
      "appointment.created",
      "appointment.updated",
      "appointment.statusChanged",
      "appointment.cancelled",
      "appointment.moved",
      "queue.updated",
    ],
    queryKey: doctorTodayKey,
    // Per-doctor scoping: without it every appointment/queue event in the
    // clinic refetched every doctor's dashboard — ×N doctors of pointless
    // traffic and DB load. Our own doctorId rides on the cached payload.
    shouldInvalidate: (event) =>
      eventTargetsDoctor(
        event,
        qc.getQueryData<DoctorToday>(doctorTodayKey)?.doctorId,
      ),
  });

  return query;
}
