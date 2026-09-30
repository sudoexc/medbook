/**
 * «Загрузка врачей на сегодня» for the Action Center (audit AC-15).
 *
 * The card used to divide each doctor's count of today's rows by a
 * hard-coded 16 («8 × 30-min slots, rough»), for the first five doctors of
 * the list only, with cancelled visits and no-shows in the count: «Dr.
 * Алиева, перегружен 125%» on a day with 20 bookings of which 6 were
 * cancelled, and a doctor on leave at 0%.
 *
 * Now, per active doctor:
 *   - booked: today's visits that still hold the doctor's time
 *     (`TODAY_VISIT_STATUSES`: booked, confirmed, waiting, on the table,
 *     seen), with their minutes;
 *   - capacity: the doctor's working time today from the schedule
 *     (`workingMinutesOn`: rows valid today, time off cut out);
 *   - load = booked minutes / working minutes, or null when the doctor has
 *     no working time today (no schedule set up, a day off, leave): there is
 *     no honest percentage to show then, only the count.
 * Doctors neither working nor booked today are left out; everyone else is
 * listed, most loaded first.
 */
import { TODAY_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import { tashkentDayBounds, tashkentComponents } from "@/lib/booking-validation";
import {
  workingMinutesOn,
  type ScheduleRowLike,
  type TimeOffLike,
} from "@/lib/doctor-working-windows";
import type { TenantScopedPrisma } from "@/lib/prisma";

export type DoctorLoadRow = {
  id: string;
  nameRu: string;
  nameUz: string;
  specializationRu: string | null;
  specializationUz: string | null;
  /** Today's visits that hold the doctor's time. */
  booked: number;
  bookedMinutes: number;
  /** Working minutes today by the schedule; 0 when not working today. */
  workingMinutes: number;
  /** Rounded booked / working minutes × 100; null without working time. */
  loadPct: number | null;
};

type DoctorIn = {
  id: string;
  nameRu: string;
  nameUz: string | null;
  specializationRu: string | null;
  specializationUz: string | null;
};

/** Pure: the rows of the card from already loaded data. */
export function computeDoctorsLoad(input: {
  todayDate: string;
  doctors: DoctorIn[];
  /** Every active schedule row of these doctors, all weekdays. */
  schedules: Array<ScheduleRowLike & { doctorId: string }>;
  timeOffs: Array<TimeOffLike & { doctorId: string }>;
  /** Today's visits in `TODAY_VISIT_STATUSES`. */
  appointments: Array<{ doctorId: string; durationMin: number | null }>;
}): DoctorLoadRow[] {
  const rows: DoctorLoadRow[] = [];
  for (const d of input.doctors) {
    const schedule = input.schedules.filter((r) => r.doctorId === d.id);
    const offs = input.timeOffs.filter((t) => t.doctorId === d.id);
    const workingMinutes = Math.round(
      workingMinutesOn(schedule, input.todayDate, offs),
    );
    const visits = input.appointments.filter((a) => a.doctorId === d.id);
    const bookedMinutes = visits.reduce(
      (sum, a) => sum + Math.max(0, a.durationMin ?? 0),
      0,
    );
    if (workingMinutes === 0 && visits.length === 0) continue;
    rows.push({
      id: d.id,
      nameRu: d.nameRu,
      nameUz: d.nameUz || d.nameRu,
      specializationRu: d.specializationRu,
      specializationUz: d.specializationUz,
      booked: visits.length,
      bookedMinutes,
      workingMinutes,
      loadPct:
        workingMinutes > 0 ? Math.round((bookedMinutes / workingMinutes) * 100) : null,
    });
  }
  return rows.sort(
    (a, b) =>
      (b.loadPct ?? -1) - (a.loadPct ?? -1) ||
      b.booked - a.booked ||
      a.nameRu.localeCompare(b.nameRu),
  );
}

/** Loads today's rows. Caller MUST be inside a TENANT context. */
export async function loadDoctorsLoad(
  prisma: TenantScopedPrisma,
  now: Date = new Date(),
): Promise<DoctorLoadRow[]> {
  const { dayStart, dayEnd } = tashkentDayBounds(now);
  const todayDate = tashkentComponents(now).date;
  const doctors = await prisma.doctor.findMany({
    where: { isActive: true },
    select: {
      id: true,
      nameRu: true,
      nameUz: true,
      specializationRu: true,
      specializationUz: true,
    },
  });
  if (doctors.length === 0) return [];
  const doctorIds = doctors.map((d) => d.id);
  const [schedules, timeOffs, appointments] = await Promise.all([
    prisma.doctorSchedule.findMany({
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
    prisma.doctorTimeOff.findMany({
      where: {
        doctorId: { in: doctorIds },
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
      select: { doctorId: true, startAt: true, endAt: true },
    }),
    prisma.appointment.findMany({
      where: {
        doctorId: { in: doctorIds },
        date: { gte: dayStart, lt: dayEnd },
        status: { in: [...TODAY_VISIT_STATUSES] },
      },
      select: { doctorId: true, durationMin: true },
    }),
  ]);
  return computeDoctorsLoad({
    todayDate,
    doctors,
    schedules,
    timeOffs,
    appointments,
  });
}
