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
import type { Prisma } from "@/generated/prisma/client";

type PrismaLike = Prisma.TransactionClient | typeof prisma;

export type ConflictResult =
  | { ok: true }
  | { ok: false; reason: string; until?: string };

function fmt(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
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
  const [h, m] = time.split(":").map((v) => Number.parseInt(v, 10));
  const out = new Date(date);
  out.setHours(h ?? 0, m ?? 0, 0, 0);
  return out;
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

  // Doctor overlap
  const doctorClash = await client.appointment.findFirst({
    where: {
      doctorId: args.doctorId,
      id: args.excludeId ? { not: args.excludeId } : undefined,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
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

  // DoctorSchedule — ensure the slot falls inside a working window for that weekday
  const weekday = args.startAt.getDay();
  const schedules = await client.doctorSchedule.findMany({
    where: {
      doctorId: args.doctorId,
      weekday,
      isActive: true,
    },
    select: { startTime: true, endTime: true },
  });
  if (schedules.length > 0) {
    const slotStart = args.startAt.getHours() * 60 + args.startAt.getMinutes();
    const slotEnd = args.endAt.getHours() * 60 + args.endAt.getMinutes();
    const inWindow = schedules.some((s) => {
      const [sh, sm] = s.startTime.split(":").map((v) => Number(v));
      const [eh, em] = s.endTime.split(":").map((v) => Number(v));
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      return slotStart >= start && slotEnd <= end;
    });
    if (!inWindow) {
      return { ok: false, reason: "outside_schedule" };
    }
  }

  return { ok: true };
}

/**
 * Return an array of "HH:mm" slots for a given doctor/date (30-min grid).
 * Slots overlapping existing appointments or DoctorTimeOff are excluded.
 * If no DoctorSchedule exists for that weekday, uses 09:00-19:00 fallback.
 */
export async function findAvailableSlots(args: {
  doctorId: string;
  date: Date;
  slotMin?: number;
}): Promise<string[]> {
  const slot = args.slotMin ?? 30;
  const weekday = args.date.getDay();
  const schedules = await prisma.doctorSchedule.findMany({
    where: { doctorId: args.doctorId, weekday, isActive: true },
    select: { startTime: true, endTime: true },
  });

  const windows =
    schedules.length > 0
      ? schedules.map((s) => ({ start: s.startTime, end: s.endTime }))
      : [{ start: "09:00", end: "19:00" }];

  const dayStart = new Date(args.date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // For today, hide slots whose start time has already passed — patients
  // and receptionists shouldn't be able to book into the past. Future
  // dates pass through unchanged.
  const now = new Date();
  const isToday =
    now.getFullYear() === dayStart.getFullYear() &&
    now.getMonth() === dayStart.getMonth() &&
    now.getDate() === dayStart.getDate();

  const [appts, timeOffs] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        doctorId: args.doctorId,
        date: { gte: dayStart, lt: dayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
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
    const [sh, sm] = w.start.split(":").map((v) => Number(v));
    const [eh, em] = w.end.split(":").map((v) => Number(v));
    const start = new Date(dayStart);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(dayStart);
    end.setHours(eh, em, 0, 0);

    for (
      let t = new Date(start);
      t.getTime() + slot * 60_000 <= end.getTime();
      t = new Date(t.getTime() + slot * 60_000)
    ) {
      if (isToday && t.getTime() <= now.getTime()) continue;
      const slotEnd = new Date(t.getTime() + slot * 60_000);
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
