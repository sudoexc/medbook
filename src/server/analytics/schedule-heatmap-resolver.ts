/**
 * Schedule heatmap: visits and free working hours per doctor, ISO weekday
 * and Tashkent hour over the 90 days before today.
 *
 * It used to read `mv_schedule_heatmap` (audit AN-24), which had two
 * faults. The hour was `EXTRACT(HOUR FROM "date")` on a column that holds
 * UTC, so a 09:00 to 18:00 clinic day drew in the 04 to 13 columns. And
 * its «свободно» was `COUNT(*)`, the visit count itself: every cell read
 * «5 запис. (свободно 5)». The view is gone (migration
 * 20261001100000_analytics_tashkent_mvs); the cells are counted here from
 * the live rows, with the rules the rest of the clinic already uses:
 *
 *   - a visit counts in the Tashkent hour it starts, any status except
 *     CANCELLED (`SLOT_OCCUPYING_STATUSES`, as the empty-slot engine);
 *   - working time is `workingIntervalsOn` (the weekday's rows valid that
 *     day, time off cut out), hours touched by any working minute;
 *   - a working hour is free when no such visit overlaps it.
 *
 * A doctor without any schedule has no working hours: his visits show,
 * with no «свободно» claim.
 */
import { tashkentDayBoundsForDateString } from "@/lib/booking-validation";
import type { prisma as prismaClient } from "@/lib/prisma";
import {
  workingIntervalsOn,
  type ScheduleRowLike,
  type TimeOffLike,
} from "@/lib/doctor-working-windows";
import { addTashkentDays, tashkentDateOf, tashkentPartsOf } from "@/lib/tashkent-time";
import {
  hoursCoveredBy,
  SLOT_OCCUPYING_STATUSES,
} from "@/server/revenue/empty-slot";

export interface ScheduleHeatmapCell {
  doctorId: string;
  /** ISO weekday, 1 = Monday .. 7 = Sunday. */
  dayOfWeek: number;
  /** Tashkent wall-clock hour, 0..23. */
  hour: number;
  /** Visits that started in this hour on this weekday over the window. */
  appointmentCount: number;
  /** Days of the window the doctor worked any part of this hour. */
  workingHourCount: number;
  /** Of those working hours, the ones no visit occupied. */
  freeHourCount: number;
}

export interface ScheduleHeatmapResult {
  cells: ScheduleHeatmapCell[];
  /** When the cells were counted; they are live, not a stored view. */
  generatedAt: string;
  /** Inclusive Tashkent days the cells cover. */
  windowFrom: string;
  windowTo: string;
  source: "live";
}

export const HEATMAP_WINDOW_DAYS = 90;

type HeatmapScheduleRow = ScheduleRowLike & { doctorId: string };
type HeatmapTimeOff = TimeOffLike & { doctorId: string };
type HeatmapVisit = { doctorId: string; date: Date; endDate: Date };

function isoWeekdayOf(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Pure: the heatmap cells from rows already loaded for `days`. */
export function buildScheduleHeatmap(input: {
  days: ReadonlyArray<string>;
  schedules: ReadonlyArray<HeatmapScheduleRow>;
  timeOffs: ReadonlyArray<HeatmapTimeOff>;
  visits: ReadonlyArray<HeatmapVisit>;
}): ScheduleHeatmapCell[] {
  const cells = new Map<string, ScheduleHeatmapCell>();
  const cell = (doctorId: string, dayOfWeek: number, hour: number) => {
    const key = `${doctorId}|${dayOfWeek}|${hour}`;
    let c = cells.get(key);
    if (!c) {
      c = {
        doctorId,
        dayOfWeek,
        hour,
        appointmentCount: 0,
        workingHourCount: 0,
        freeHourCount: 0,
      };
      cells.set(key, c);
    }
    return c;
  };

  const inWindow = new Set(input.days);
  const visitsByDoctorDay = new Map<string, HeatmapVisit[]>();
  for (const v of input.visits) {
    const start = tashkentPartsOf(v.date);
    if (!inWindow.has(start.date)) continue;
    cell(v.doctorId, isoWeekdayOf(start.date), start.hours).appointmentCount += 1;
    // A visit may run past midnight: file it under every day it touches.
    for (const day of new Set([start.date, tashkentDateOf(v.endDate)])) {
      const key = `${v.doctorId}|${day}`;
      const arr = visitsByDoctorDay.get(key) ?? [];
      arr.push(v);
      visitsByDoctorDay.set(key, arr);
    }
  }

  const rowsByDoctor = new Map<string, HeatmapScheduleRow[]>();
  for (const r of input.schedules) {
    const arr = rowsByDoctor.get(r.doctorId) ?? [];
    arr.push(r);
    rowsByDoctor.set(r.doctorId, arr);
  }
  const offsByDoctor = new Map<string, HeatmapTimeOff[]>();
  for (const t of input.timeOffs) {
    const arr = offsByDoctor.get(t.doctorId) ?? [];
    arr.push(t);
    offsByDoctor.set(t.doctorId, arr);
  }

  for (const [doctorId, rows] of rowsByDoctor) {
    const offs = offsByDoctor.get(doctorId) ?? [];
    for (const day of input.days) {
      const { dayStart } = tashkentDayBoundsForDateString(day);
      const working = hoursCoveredBy(workingIntervalsOn(rows, day, offs), dayStart);
      if (working.length === 0) continue;
      const booked = new Set(
        hoursCoveredBy(
          (visitsByDoctorDay.get(`${doctorId}|${day}`) ?? []).map((v) => ({
            start: v.date,
            end: v.endDate,
          })),
          dayStart,
        ),
      );
      const dow = isoWeekdayOf(day);
      for (const h of working) {
        const c = cell(doctorId, dow, h);
        c.workingHourCount += 1;
        if (!booked.has(h)) c.freeHourCount += 1;
      }
    }
  }

  return [...cells.values()].sort(
    (a, b) =>
      a.doctorId.localeCompare(b.doctorId) ||
      a.dayOfWeek - b.dayOfWeek ||
      a.hour - b.hour,
  );
}

/** Tenant scope comes from the caller's client. */
type HeatmapDb = Pick<
  typeof prismaClient,
  "appointment" | "doctorSchedule" | "doctorTimeOff"
>;

export async function resolveScheduleHeatmap(
  db: HeatmapDb,
  clinicId: string,
  now: Date = new Date(),
): Promise<ScheduleHeatmapResult> {
  // The 90 whole Tashkent days before today: today is still being booked,
  // so its later hours would read as free when they are only not yet sold.
  const today = tashkentDateOf(now);
  const days: string[] = [];
  for (let i = HEATMAP_WINDOW_DAYS; i >= 1; i -= 1) days.push(addTashkentDays(today, -i));
  const from = tashkentDayBoundsForDateString(days[0]!).dayStart;
  const to = tashkentDayBoundsForDateString(today).dayStart;

  const [visits, schedules, timeOffs] = await Promise.all([
    db.appointment.findMany({
      where: {
        clinicId,
        date: { gte: from, lt: to },
        status: { in: [...SLOT_OCCUPYING_STATUSES] },
      },
      select: { doctorId: true, date: true, endDate: true },
    }),
    db.doctorSchedule.findMany({
      where: { clinicId, isActive: true },
      select: {
        doctorId: true,
        weekday: true,
        startTime: true,
        endTime: true,
        validFrom: true,
        validTo: true,
      },
    }),
    db.doctorTimeOff.findMany({
      where: { clinicId, startAt: { lt: to }, endAt: { gt: from } },
      select: { doctorId: true, startAt: true, endAt: true },
    }),
  ]);

  return {
    cells: buildScheduleHeatmap({ days, schedules, timeOffs, visits }),
    generatedAt: now.toISOString(),
    windowFrom: days[0]!,
    windowTo: days[days.length - 1]!,
    source: "live",
  };
}
