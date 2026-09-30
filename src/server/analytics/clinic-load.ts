/**
 * «Динамика загрузки клиники» on the analytics dashboard (audit UX-03).
 *
 * The card used to draw `round(day's visits / busiest day's visits × 90)`:
 * the busiest day was always 90 %, every other day a share of it, «like
 * the target». Now a day's load is the minutes the visits hold against the
 * minutes the doctors work by their schedule, the same measure as the
 * Action Center's «Загрузка врачей» and the doctors page:
 *   booked   visits that hold the doctor's time (`TODAY_VISIT_STATUSES`:
 *            not cancelled, not missed), with their own lengths;
 *   working  `workingMinutesOn`: schedule rows valid that day, time off cut
 *            out.
 * A day nobody works (a Sunday, a holiday) has no load, not 0 %. The
 * card's figure is Σbooked / Σworking over the period, and its chip the
 * change against the period before, in percentage points.
 *
 * Doctors in scope: the active ones, plus any doctor with visits in the
 * window (a doctor deactivated since still worked then). A DOCTOR sees
 * only himself.
 */
import type { prisma as prismaClient } from "@/lib/prisma";
import { TODAY_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import {
  workingMinutesOn,
  type ScheduleRowLike,
  type TimeOffLike,
} from "@/lib/doctor-working-windows";
import { eachDay, ymdKey } from "@/server/analytics/range";

export interface ClinicLoadDay {
  date: string;
  bookedMin: number;
  workingMin: number;
  /** Percent; null when nobody works that day. */
  load: number | null;
}

export interface ClinicLoadTotals {
  bookedMin: number;
  workingMin: number;
  /** Percent over the whole window; null without working time. */
  loadPct: number | null;
}

export interface ClinicLoad extends ClinicLoadTotals {
  daily: ClinicLoadDay[];
}

export type LoadVisit = { doctorId: string; date: Date; durationMin: number | null };

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** Pure: the window's daily load from loaded rows. */
export function computeClinicLoad(input: {
  days: ReadonlyArray<string>;
  doctorIds: ReadonlyArray<string>;
  schedules: ReadonlyArray<ScheduleRowLike & { doctorId: string }>;
  timeOffs: ReadonlyArray<TimeOffLike & { doctorId: string }>;
  /** Visits in `TODAY_VISIT_STATUSES` of the window. */
  visits: ReadonlyArray<LoadVisit>;
}): ClinicLoad {
  const bookedByDay = new Map<string, number>();
  for (const v of input.visits) {
    const k = ymdKey(v.date);
    bookedByDay.set(k, (bookedByDay.get(k) ?? 0) + Math.max(0, v.durationMin ?? 0));
  }
  const byDoctor = input.doctorIds.map((id) => ({
    schedule: input.schedules.filter((r) => r.doctorId === id),
    offs: input.timeOffs.filter((t) => t.doctorId === id),
  }));

  const daily: ClinicLoadDay[] = [];
  let bookedMin = 0;
  let workingMin = 0;
  for (const date of input.days) {
    const working = Math.round(
      byDoctor.reduce((sum, d) => sum + workingMinutesOn(d.schedule, date, d.offs), 0),
    );
    const booked = bookedByDay.get(date) ?? 0;
    daily.push({ date, bookedMin: booked, workingMin: working, load: pct(booked, working) });
    bookedMin += booked;
    workingMin += working;
  }
  return { daily, bookedMin, workingMin, loadPct: pct(bookedMin, workingMin) };
}

type Db = Pick<
  typeof prismaClient,
  "doctor" | "doctorSchedule" | "doctorTimeOff" | "appointment"
>;

/**
 * The window's load and the previous window's totals, in four queries.
 * Tenant scope comes from the caller's client.
 */
export async function loadClinicLoad(
  db: Db,
  opts: {
    from: Date;
    to: Date;
    previous: { from: Date; to: Date };
    doctorId: string | null;
  },
): Promise<ClinicLoad & { previous: ClinicLoadTotals }> {
  const scope = opts.doctorId ? { doctorId: opts.doctorId } : {};
  const visits = await db.appointment.findMany({
    where: {
      ...scope,
      date: { gte: opts.previous.from, lt: opts.to },
      status: { in: [...TODAY_VISIT_STATUSES] },
    },
    select: { doctorId: true, date: true, durationMin: true },
  });

  let doctorIds: string[];
  if (opts.doctorId) {
    doctorIds = [opts.doctorId];
  } else {
    const active = await db.doctor.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    doctorIds = [...new Set([...active.map((d) => d.id), ...visits.map((v) => v.doctorId)])];
  }

  const [schedules, timeOffs] =
    doctorIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.doctorSchedule.findMany({
            where: { doctorId: { in: doctorIds }, isActive: true },
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
            where: {
              doctorId: { in: doctorIds },
              startAt: { lt: opts.to },
              endAt: { gt: opts.previous.from },
            },
            select: { doctorId: true, startAt: true, endAt: true },
          }),
        ]);

  const inWindow = (from: Date, to: Date) =>
    visits.filter((v) => v.date >= from && v.date < to);
  const current = computeClinicLoad({
    days: eachDay(opts.from, opts.to),
    doctorIds,
    schedules,
    timeOffs,
    visits: inWindow(opts.from, opts.to),
  });
  const before = computeClinicLoad({
    days: eachDay(opts.previous.from, opts.previous.to),
    doctorIds,
    schedules,
    timeOffs,
    visits: inWindow(opts.previous.from, opts.previous.to),
  });
  return {
    ...current,
    previous: {
      bookedMin: before.bookedMin,
      workingMin: before.workingMin,
      loadPct: before.loadPct,
    },
  };
}
