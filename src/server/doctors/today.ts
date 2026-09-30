/**
 * «Сегодня» on the doctors page, from the real schedule and today's visits
 * (audit DR-08).
 *
 * The page used to make up most of its day:
 *   - capacity was 10 visits a day and the day 09:00-18:00 for every doctor
 *     (`DAY_CAPACITY`, `WORKING_HOURS`), whatever DoctorSchedule said, so a
 *     Mon–Fri doctor had «свободные окна» on Saturday and a doctor on leave
 *     read 0 % instead of «не работает»;
 *   - every booking counted as 30 minutes, cancelled and missed ones
 *     included, and «Ближайшее окно» was the first hour without a booking,
 *     09:00 at 16:00 included;
 *   - a gap of an hour was labelled «Обед»;
 *   - «Выручка сегодня» showed the month;
 *   - the hour heatmap assumed two visits an hour and showed the first
 *     five doctors by name, deactivated ones too.
 *
 * Per active doctor, today (Tashkent day):
 *   workingMinutes  the schedule valid today with time off cut out
 *                   (`workingIntervalsOn`, shared with the Action Center
 *                   load and the sidebar);
 *   booked, bookedMinutes
 *                   visits that hold the doctor's time
 *                   (`TODAY_VISIT_STATUSES`: not cancelled, not missed),
 *                   with their real lengths;
 *   loadPct         bookedMinutes / workingMinutes, null without working
 *                   time (there is no honest percentage then);
 *   status          busy: a visit is on the table; free: inside working
 *                   time with nobody on the table; off: outside working
 *                   time or not working today;
 *   nextFree        the first free slot from now on, by the booking
 *                   calendar's own rule (`findAvailableSlots`), null when
 *                   the day has none left;
 *   revenueToday    COMPLETED visits of today: priceFinal, or the service
 *                   price minus the discount when no final price was
 *                   written (the definition of `server/doctors/stats.ts`);
 *   hours           per hour of the day, the working and the booked
 *                   minutes in it, for the heatmap.
 */
import type { prisma as prismaClient } from "@/lib/prisma";
import { TODAY_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import {
  tashkentComponents,
  tashkentDayBounds,
} from "@/lib/booking-validation";
import {
  workingIntervalsOn,
  type ScheduleRowLike,
  type TimeOffLike,
  type WorkingInterval,
} from "@/lib/doctor-working-windows";

export type DoctorTodayStatus = "busy" | "free" | "off";

export interface DoctorHourLoad {
  /** Hour of the Tashkent day, 0..23. */
  hour: number;
  workingMin: number;
  bookedMin: number;
}

export interface DoctorTodayRow {
  doctorId: string;
  workingMinutes: number;
  booked: number;
  bookedMinutes: number;
  loadPct: number | null;
  status: DoctorTodayStatus;
  /** "HH:mm" in Tashkent, null when nothing is free today any more. */
  nextFree: string | null;
  revenueToday: number;
  /** Only the hours with working time or bookings. */
  hours: DoctorHourLoad[];
}

export interface DoctorsToday {
  /** Tashkent day, "YYYY-MM-DD". */
  date: string;
  doctors: DoctorTodayRow[];
  clinic: {
    booked: number;
    bookedMinutes: number;
    workingMinutes: number;
    /** Null when nobody works today by the schedule. */
    loadPct: number | null;
  };
}

export type TodayVisit = {
  doctorId: string;
  status: string;
  date: Date;
  durationMin: number | null;
  priceFinal: number | null;
  priceService: number | null;
  discountAmount: number | null;
};

const HOUR_MS = 3_600_000;
const HOLDS_TIME: ReadonlySet<string> = new Set(TODAY_VISIT_STATUSES);

function overlapMin(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const ms = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  return ms > 0 ? ms / 60_000 : 0;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** Revenue of one COMPLETED visit, as `server/doctors/stats.ts` counts it. */
export function visitRevenue(v: Pick<TodayVisit, "priceFinal" | "priceService" | "discountAmount">): number {
  if (v.priceFinal !== null) return v.priceFinal;
  return (v.priceService ?? 0) - (v.discountAmount ?? 0);
}

/** Pure: the page's day from loaded data. */
export function computeDoctorsToday(input: {
  now: Date;
  doctorIds: ReadonlyArray<string>;
  /** Every active schedule row of these doctors, all weekdays. */
  schedules: ReadonlyArray<ScheduleRowLike & { doctorId: string }>;
  timeOffs: ReadonlyArray<TimeOffLike & { doctorId: string }>;
  /** Today's visits of these doctors, any status. */
  visits: ReadonlyArray<TodayVisit>;
  /** First free slot per doctor ("HH:mm"), from the booking calendar. */
  nextFree: ReadonlyMap<string, string | null>;
}): DoctorsToday {
  const date = tashkentComponents(input.now).date;
  const { dayStart } = tashkentDayBounds(input.now);
  const base = dayStart.getTime();
  const nowMs = input.now.getTime();

  const doctors: DoctorTodayRow[] = [];
  let clinicBooked = 0;
  let clinicBookedMin = 0;
  let clinicWorkingMin = 0;

  for (const doctorId of input.doctorIds) {
    const intervals: WorkingInterval[] = workingIntervalsOn(
      input.schedules.filter((r) => r.doctorId === doctorId),
      date,
      input.timeOffs.filter((t) => t.doctorId === doctorId),
    );
    const workingMinutes = Math.round(
      intervals.reduce(
        (sum, i) => sum + (i.end.getTime() - i.start.getTime()) / 60_000,
        0,
      ),
    );
    const own = input.visits.filter((v) => v.doctorId === doctorId);
    const holding = own.filter((v) => HOLDS_TIME.has(v.status));
    const bookedMinutes = holding.reduce(
      (sum, v) => sum + Math.max(0, v.durationMin ?? 0),
      0,
    );
    const revenueToday = own
      .filter((v) => v.status === "COMPLETED")
      .reduce((sum, v) => sum + visitRevenue(v), 0);

    const onTable = own.some((v) => v.status === "IN_PROGRESS");
    const inShift = intervals.some(
      (i) => i.start.getTime() <= nowMs && nowMs < i.end.getTime(),
    );
    const status: DoctorTodayStatus = onTable ? "busy" : inShift ? "free" : "off";

    const hours: DoctorHourLoad[] = [];
    for (let h = 0; h < 24; h += 1) {
      const hs = base + h * HOUR_MS;
      const he = hs + HOUR_MS;
      const workingMin = intervals.reduce(
        (sum, i) => sum + overlapMin(i.start.getTime(), i.end.getTime(), hs, he),
        0,
      );
      const bookedMin = holding.reduce((sum, v) => {
        const s = v.date.getTime();
        return sum + overlapMin(s, s + Math.max(0, v.durationMin ?? 0) * 60_000, hs, he);
      }, 0);
      if (workingMin > 0 || bookedMin > 0) {
        hours.push({
          hour: h,
          workingMin: Math.round(workingMin),
          bookedMin: Math.round(bookedMin),
        });
      }
    }

    doctors.push({
      doctorId,
      workingMinutes,
      booked: holding.length,
      bookedMinutes,
      loadPct: pct(bookedMinutes, workingMinutes),
      status,
      nextFree: input.nextFree.get(doctorId) ?? null,
      revenueToday,
      hours,
    });
    clinicBooked += holding.length;
    clinicBookedMin += bookedMinutes;
    clinicWorkingMin += workingMinutes;
  }

  return {
    date,
    doctors,
    clinic: {
      booked: clinicBooked,
      bookedMinutes: clinicBookedMin,
      workingMinutes: clinicWorkingMin,
      loadPct: pct(clinicBookedMin, clinicWorkingMin),
    },
  };
}

type Db = Pick<
  typeof prismaClient,
  "doctor" | "doctorSchedule" | "doctorTimeOff" | "appointment"
>;

/**
 * Loads today for the active doctors (or one of them). Caller MUST be in a
 * TENANT context: the queries rely on the tenant scope, and
 * `findNextFree` is the booking calendar's slot finder.
 */
export async function loadDoctorsToday(
  db: Db,
  args: {
    doctorId?: string;
    now?: Date;
    findNextFree: (doctorId: string, now: Date) => Promise<string | null>;
  },
): Promise<DoctorsToday> {
  const now = args.now ?? new Date();
  const { dayStart, dayEnd } = tashkentDayBounds(now);
  const doctors = await db.doctor.findMany({
    where: { isActive: true, ...(args.doctorId ? { id: args.doctorId } : {}) },
    select: { id: true },
  });
  const doctorIds = doctors.map((d) => d.id);
  if (doctorIds.length === 0) {
    return computeDoctorsToday({
      now,
      doctorIds,
      schedules: [],
      timeOffs: [],
      visits: [],
      nextFree: new Map(),
    });
  }
  const [schedules, timeOffs, visits, nextFreeList] = await Promise.all([
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
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
      select: { doctorId: true, startAt: true, endAt: true },
    }),
    db.appointment.findMany({
      where: { doctorId: { in: doctorIds }, date: { gte: dayStart, lt: dayEnd } },
      select: {
        doctorId: true,
        status: true,
        date: true,
        durationMin: true,
        priceFinal: true,
        priceService: true,
        discountAmount: true,
      },
    }),
    Promise.all(
      doctorIds.map(async (id) => [id, await args.findNextFree(id, now)] as const),
    ),
  ]);
  return computeDoctorsToday({
    now,
    doctorIds,
    schedules,
    timeOffs,
    visits,
    nextFree: new Map(nextFreeList),
  });
}
