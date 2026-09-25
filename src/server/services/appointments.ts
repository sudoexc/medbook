/**
 * Appointment scheduling helpers:
 *  - computeEndDate(date, durationMin)
 *  - detectConflicts({ doctorId, cabinetId, startAt, endAt, excludeId? })
 *  - findAvailableSlots({ doctorId, date, slotMin })
 *
 * See docs/TZ.md §6.2 (bookings), §6.3 (calendar), §7.8 (NewAppointmentDialog).
 *
 * Conflicts raise on:
 *   - overlapping Appointment for the same doctor (non-CANCELLED/NO_SHOW)
 *   - overlapping Appointment in the same cabinet (if cabinetId provided)
 *   - DoctorTimeOff covering any part of the slot
 *   - outside DoctorSchedule for the weekday
 */
import { prisma } from "@/lib/prisma";
import {
  tashkentComponents,
  tashkentDayBounds,
  toTashkentDate,
} from "@/lib/booking-validation";
import {
  workingWindowsFor,
  type ScheduleRowLike,
} from "@/lib/doctor-working-windows";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type ConflictResult =
  | { ok: true }
  | { ok: false; reason: string; until?: string };

// Format an instant as Tashkent wall-clock "HH:mm". Never use the server's
// local Date.getHours() — prod runs UTC, which would skew the result by 5h.
function fmt(d: Date): string {
  return tashkentComponents(d).time;
}

function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(":").map((x) => Number(x));
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Every active schedule row of the doctor, all weekdays: whether the doctor
 * has a schedule at all decides between «day off» and the no-schedule
 * fallback (see `workingWindowsFor`).
 */
async function loadActiveScheduleRows(
  client: PrismaLike,
  doctorId: string,
): Promise<ScheduleRowLike[]> {
  return client.doctorSchedule.findMany({
    where: { doctorId, isActive: true },
    select: {
      weekday: true,
      startTime: true,
      endTime: true,
      validFrom: true,
      validTo: true,
    },
  });
}

export function computeEndDate(start: Date, durationMin: number): Date {
  return new Date(start.getTime() + durationMin * 60_000);
}

/**
 * Merge `date` (date part) with `time` ("HH:mm") into a Date. If `time`
 * is null/undefined, the date is returned as-is.
 */
export function applyTime(date: Date, time: string | null | undefined): Date {
  if (!time) return date;
  // Prod runs UTC; setHours() uses server-local TZ, which skews the booked
  // instant by 5h vs. the Tashkent wall clock the picker emits. Rebuild via
  // Tashkent calendar date + picked HH:mm at +05:00.
  const { date: dateStr } = tashkentComponents(date);
  return toTashkentDate(dateStr, time);
}

export async function detectConflicts(
  args: {
    doctorId: string;
    cabinetId?: string | null;
    startAt: Date;
    endAt: Date;
    excludeId?: string;
  },
  client: PrismaLike = prisma,
): Promise<ConflictResult> {
  // Reject bookings whose start has already passed — guards against stale
  // slot lists on the client (Mini App or CRM dialog) submitting a past
  // time. Only blocks new bookings; reschedules pass `excludeId` and may
  // legitimately touch past appointments (e.g. mark NO_SHOW).
  if (!args.excludeId && args.startAt.getTime() <= Date.now()) {
    return { ok: false, reason: "in_past" };
  }

  // Doctor overlap. Walk-ins are order-based, not slot-based — they stack in
  // the live queue and don't reserve a calendar slot, so a scheduled booking
  // must not be blocked by an overlapping walk-in window. This mirrors the DB
  // EXCLUDE constraints, which carry the same `channel <> 'WALKIN'` predicate.
  const doctorClash = await client.appointment.findFirst({
    where: {
      doctorId: args.doctorId,
      id: args.excludeId ? { not: args.excludeId } : undefined,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      channel: { not: "WALKIN" },
      date: { lt: args.endAt },
      endDate: { gt: args.startAt },
    },
    select: { id: true, endDate: true },
  });
  if (doctorClash) {
    return {
      ok: false,
      reason: "doctor_busy",
      until: fmt(doctorClash.endDate),
    };
  }

  // Cabinet overlap
  if (args.cabinetId) {
    const cabinetClash = await client.appointment.findFirst({
      where: {
        cabinetId: args.cabinetId,
        id: args.excludeId ? { not: args.excludeId } : undefined,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        channel: { not: "WALKIN" },
        date: { lt: args.endAt },
        endDate: { gt: args.startAt },
      },
      select: { id: true, endDate: true },
    });
    if (cabinetClash) {
      return {
        ok: false,
        reason: "cabinet_busy",
        until: fmt(cabinetClash.endDate),
      };
    }
  }

  // Doctor time-off
  const timeOff = await client.doctorTimeOff.findFirst({
    where: {
      doctorId: args.doctorId,
      startAt: { lt: args.endAt },
      endAt: { gt: args.startAt },
    },
    select: { endAt: true },
  });
  if (timeOff) {
    return {
      ok: false,
      reason: "doctor_time_off",
      until: fmt(timeOff.endAt),
    };
  }

  // DoctorSchedule — the slot must fall inside one of that day's working
  // windows. All comparisons use Tashkent wall clock; server-local
  // `getDay()` / `getHours()` skews by 5h on the UTC prod box and flips
  // weekday near midnight, so we route everything through tashkentComponents.
  //
  // Once the doctor has any schedule, a weekday without rows is a day off
  // (audit AP-01): the check used to run only when THAT weekday had rows, so
  // a day off accepted any time. A doctor with no schedule at all stays
  // unconstrained here, as before; the slot picker offers them the
  // 09:00-19:00 fallback, and staff may still book outside it by hand.
  const scheduleRows = await loadActiveScheduleRows(client, args.doctorId);
  if (scheduleRows.length > 0) {
    const startComp = tashkentComponents(args.startAt);
    const endComp = tashkentComponents(args.endAt);
    const windows = workingWindowsFor(scheduleRows, startComp.date);
    const slotStart = startComp.minutes;
    // A slot running past midnight never fits a day's window; one ending
    // exactly at midnight reads as 24:00 of the same day.
    const slotEnd =
      endComp.date === startComp.date
        ? endComp.minutes
        : endComp.minutes === 0 &&
            args.endAt.getTime() - args.startAt.getTime() <= 24 * 60 * 60_000
          ? 24 * 60
          : Number.POSITIVE_INFINITY;
    const inWindow = windows.some((w) => {
      const start = hhmmToMinutes(w.start);
      const end = hhmmToMinutes(w.end);
      return slotStart >= start && slotEnd <= end;
    });
    if (!inWindow) {
      return { ok: false, reason: "outside_schedule" };
    }
  }

  return { ok: true };
}

/**
 * Bookable-slot grid step (minutes) — the interval BETWEEN slot starts.
 * Decoupled from appointment length.
 */
export const DEFAULT_SLOT_STEP_MIN = 20;

/**
 * Return every free "HH:mm" slot for a given doctor/date on a 20-min grid.
 *
 * Two-lanes model (docs/TZ-two-lanes.md): the schedule lane is bounded ONLY by
 * the doctor's working windows, DoctorTimeOff, and booking-vs-booking overlap.
 * The old `maxBookableSlotsPerDay` cap (which reserved "the rest of the day"
 * for the walk-in queue) is gone — bookings and the live queue are independent,
 * so there is nothing to reserve. Walk-in rows don't block slots either: they
 * are order-based, their `[now, now+30)` window is technical (mirrors
 * `detectConflicts` + the DB EXCLUDE constraints' `channel <> WALKIN`).
 * Working windows come from `workingWindowsFor`: a weekday without schedule
 * rows is a day off, and only a doctor with no schedule at all gets the
 * 09:00-19:00 fallback.
 */
export async function findAvailableSlots(args: {
  doctorId: string;
  date: Date;
  /** Appointment block length for overlap checks (service sum). Default = step. */
  slotMin?: number;
  /** Grid cadence between slot starts. Default DEFAULT_SLOT_STEP_MIN (20m). */
  stepMin?: number;
}): Promise<string[]> {
  const step = args.stepMin ?? DEFAULT_SLOT_STEP_MIN;
  const block = args.slotMin ?? step;

  // All reasoning is in Tashkent wall clock. Server-local helpers
  // (`getDay`, `setHours(0,0,0,0)`) silently skew ±5h on UTC prod and used
  // to leak today's already-passed slots into the picker.
  const dateComp = tashkentComponents(args.date);
  const { dayStart, dayEnd } = tashkentDayBounds(args.date);

  // A weekday without rows is a day off (no slots); only a doctor with no
  // schedule at all keeps the 09:00-19:00 fallback (audit AP-01).
  const windows = workingWindowsFor(
    await loadActiveScheduleRows(prisma, args.doctorId),
    dateComp.date,
  );
  if (windows.length === 0) return [];

  const now = new Date();
  const isToday = tashkentComponents(now).date === dateComp.date;

  const [appts, timeOffs] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        doctorId: args.doctorId,
        date: { gte: dayStart, lt: dayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        // Walk-ins don't reserve calendar slots (same predicate as
        // detectConflicts + the DB EXCLUDE constraints).
        channel: { not: "WALKIN" },
      },
      select: { date: true, endDate: true },
    }),
    prisma.doctorTimeOff.findMany({
      where: {
        doctorId: args.doctorId,
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);

  const slots: string[] = [];
  for (const w of windows) {
    // Anchor window edges to Tashkent wall clock for the requested calendar
    // day, then iterate the UTC instants. The instants are correct because
    // they were constructed via `+05:00` offset. Advance by `step` (cadence),
    // size each candidate by `block` (appointment length) for overlap checks.
    const start = toTashkentDate(dateComp.date, w.start);
    const end = toTashkentDate(dateComp.date, w.end);

    for (
      let t = new Date(start);
      t.getTime() + block * 60_000 <= end.getTime();
      t = new Date(t.getTime() + step * 60_000)
    ) {
      if (isToday && t.getTime() <= now.getTime()) continue;
      const slotEnd = new Date(t.getTime() + block * 60_000);
      const clashAppt = appts.some(
        (a) => a.date < slotEnd && a.endDate > t
      );
      if (clashAppt) continue;
      const clashOff = timeOffs.some(
        (o) => o.startAt < slotEnd && o.endAt > t
      );
      if (clashOff) continue;
      slots.push(fmt(t));
    }
  }
  return slots;
}
