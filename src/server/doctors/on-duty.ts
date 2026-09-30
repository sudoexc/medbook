/**
 * Which doctors work today, for the waiting-room TV and the kiosk
 * (audit Q-08).
 *
 * Both screens used to list every active doctor with a schedule row for
 * today's weekday. The row's validity (`validFrom` / `validTo`) and
 * `DoctorTimeOff` were ignored, so a neurologist on leave stayed on the
 * kiosk: a patient took a ticket and waited hours for a doctor who was not
 * coming. The other way round, a doctor who came in on a Saturday outside
 * his schedule had patients registered by reception and no column on the
 * TV.
 *
 * The rule, one place for the TV board, the kiosk list and the kiosk's
 * walk-in:
 *   - the doctor sees patients today: reception already has him a live
 *     queue (someone waiting, on the table or skipped). That is the fact on
 *     the ground and beats whatever the schedule says;
 *   - otherwise the schedule decides: working time today by the rows valid
 *     today with every time off cut out (`workingIntervalsOn`), and no time
 *     off covering this very moment (a doctor away 10:00 to 12:00 is not
 *     offered at 11:00, even though he works the afternoon).
 * A doctor with no schedule at all and no queue is not on duty: the
 * 09:00-19:00 fallback of the booking calendar is a convenience, not a
 * statement that someone is in the building.
 */
import type { prisma as prismaClient } from "@/lib/prisma";
import {
  tashkentComponents,
  tashkentDayBounds,
} from "@/lib/booking-validation";
import {
  workingIntervalsOn,
  type ScheduleRowLike,
  type TimeOffLike,
} from "@/lib/doctor-working-windows";

/** Reception's lane statuses that mean the doctor is seeing patients. */
export const LIVE_QUEUE_STATUSES = ["WAITING", "IN_PROGRESS", "SKIPPED"] as const;

function ms(v: Date | string): number {
  return (v instanceof Date ? v : new Date(v)).getTime();
}

/** Pure: the rule above for one doctor. */
export function isDoctorOnDuty(input: {
  /** Every ACTIVE schedule row of the doctor, all weekdays. */
  schedule: ReadonlyArray<ScheduleRowLike>;
  /** The doctor's time off touching today. */
  timeOffs: ReadonlyArray<TimeOffLike>;
  /** Today in Tashkent, "YYYY-MM-DD". */
  todayDate: string;
  now: Date;
  /** Reception has a live queue for him today. */
  hasLiveQueue: boolean;
}): boolean {
  if (input.hasLiveQueue) return true;
  if (workingIntervalsOn(input.schedule, input.todayDate, input.timeOffs).length === 0) {
    return false;
  }
  const now = input.now.getTime();
  return !input.timeOffs.some((t) => ms(t.startAt) <= now && now < ms(t.endAt));
}

type Db = Pick<typeof prismaClient, "doctorSchedule" | "doctorTimeOff" | "appointment">;

/**
 * The ids among `doctorIds` on duty right now. Three queries, whatever the
 * number of doctors. Every query pins `clinicId`: the public screens run in
 * the SYSTEM context, where nothing is injected.
 */
export async function loadOnDutyDoctorIds(
  db: Db,
  args: { clinicId: string; doctorIds: ReadonlyArray<string>; now?: Date },
): Promise<Set<string>> {
  const out = new Set<string>();
  if (args.doctorIds.length === 0) return out;
  const now = args.now ?? new Date();
  const todayDate = tashkentComponents(now).date;
  const { dayStart, dayEnd } = tashkentDayBounds(now);
  const doctorIds = [...args.doctorIds];

  const [schedules, timeOffs, live] = await Promise.all([
    db.doctorSchedule.findMany({
      where: { clinicId: args.clinicId, doctorId: { in: doctorIds }, isActive: true },
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
        clinicId: args.clinicId,
        doctorId: { in: doctorIds },
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
      select: { doctorId: true, startAt: true, endAt: true },
    }),
    db.appointment.findMany({
      where: {
        clinicId: args.clinicId,
        doctorId: { in: doctorIds },
        date: { gte: dayStart, lt: dayEnd },
        queueStatus: { in: [...LIVE_QUEUE_STATUSES] },
      },
      select: { doctorId: true },
      distinct: ["doctorId"],
    }),
  ]);

  const liveIds = new Set(live.map((r) => r.doctorId));
  for (const doctorId of doctorIds) {
    if (
      isDoctorOnDuty({
        schedule: schedules.filter((r) => r.doctorId === doctorId),
        timeOffs: timeOffs.filter((t) => t.doctorId === doctorId),
        todayDate,
        now,
        hasLiveQueue: liveIds.has(doctorId),
      })
    ) {
      out.add(doctorId);
    }
  }
  return out;
}
