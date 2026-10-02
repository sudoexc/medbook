/**
 * Detector: LOW_DOCTOR_SCHEDULE.
 *
 * For each active doctor, count the total declared scheduled hours over the
 * next 7 days from `DoctorSchedule` rows. We translate each row to the
 * concrete date(s) within the window, subtract any `DoctorTimeOff` overlap,
 * and divide hours into 1-hour slot units.
 *
 * Each day is a Tashkent calendar day and its working time comes from
 * `workingIntervalsOn`, the same rule EMPTY_SLOT_TOMORROW uses (audit
 * AC-20). The window starts at the clinic's midnight, 19:00Z of the previous
 * UTC day, so `getUTCDay()` read the previous weekday and `setUTCHours` put
 * a 09:00 shift at 09:00Z of that previous date: leave and the
 * `validFrom` / `validTo` bounds were matched against shifts a day and five
 * hours off, and a Wed..Fri holiday cut the wrong hours.
 *
 * Action fires when the count falls below `lowScheduleSlotsThreshold` AND
 * the doctor isn't on an open-ended time-off covering the whole window.
 *
 * Severity: `medium`. Assignee defaults to ADMIN (per `defaultAssigneeRole`).
 */
import type { LowDoctorSchedulePayload } from "@/lib/actions/types";
import { tashkentComponents } from "@/lib/booking-validation";
import { workingIntervalsOn } from "@/lib/doctor-working-windows";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { addDays, startOfClinicDay } from "./_shared";

type DoctorRow = {
  id: string;
  nameRu: string;
  isActive: boolean;
};
type ScheduleRow = {
  doctorId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom: Date | null;
  validTo: Date | null;
  isActive: boolean;
};
type TimeOffRow = {
  doctorId: string;
  startAt: Date;
  endAt: Date;
};

export async function detectLowDoctorSchedule(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<LowDoctorSchedulePayload[]> {
  const windowStart = startOfClinicDay(now);
  const windowEnd = addDays(windowStart, 7);

  const doctors = (await prisma.doctor.findMany({
    where: { isActive: true },
    select: { id: true, nameRu: true, isActive: true },
  })) as DoctorRow[];
  if (doctors.length === 0) return [];

  const doctorIds = doctors.map((d) => d.id);

  const schedules = (await prisma.doctorSchedule.findMany({
    where: {
      doctorId: { in: doctorIds },
      isActive: true,
    },
    select: {
      doctorId: true,
      weekday: true,
      startTime: true,
      endTime: true,
      validFrom: true,
      validTo: true,
      isActive: true,
    },
  })) as ScheduleRow[];

  const timeOffs = (await prisma.doctorTimeOff.findMany({
    where: {
      doctorId: { in: doctorIds },
      endAt: { gte: windowStart },
      startAt: { lte: windowEnd },
    },
    select: { doctorId: true, startAt: true, endAt: true },
  })) as TimeOffRow[];

  const schedByDoctor = new Map<string, ScheduleRow[]>();
  for (const s of schedules) {
    const arr = schedByDoctor.get(s.doctorId) ?? [];
    arr.push(s);
    schedByDoctor.set(s.doctorId, arr);
  }
  const offsByDoctor = new Map<string, TimeOffRow[]>();
  for (const t of timeOffs) {
    const arr = offsByDoctor.get(t.doctorId) ?? [];
    arr.push(t);
    offsByDoctor.set(t.doctorId, arr);
  }

  const out: LowDoctorSchedulePayload[] = [];

  for (const d of doctors) {
    // Skip doctors fully covered by time-off across the entire 7-day window.
    const offs = offsByDoctor.get(d.id) ?? [];
    const fullyOff = offs.some(
      (t) =>
        t.startAt.getTime() <= windowStart.getTime() &&
        t.endAt.getTime() >= windowEnd.getTime(),
    );
    if (fullyOff) continue;

    const sched = schedByDoctor.get(d.id) ?? [];
    if (sched.length === 0) {
      out.push({
        type: "LOW_DOCTOR_SCHEDULE",
        doctorId: d.id,
        doctorName: d.nameRu,
        slotsNext7Days: 0,
      });
      continue;
    }

    let slots = 0;
    // Walk the 7-day window one Tashkent day at a time. The clinic has no
    // DST, so each 24h step from its midnight lands on the next midnight.
    for (let i = 0; i < 7; i++) {
      const dateStr = tashkentComponents(addDays(windowStart, i)).date;
      for (const w of workingIntervalsOn(sched, dateStr, offs)) {
        const hours = (w.end.getTime() - w.start.getTime()) / (60 * 60 * 1000);
        if (hours > 0) slots += Math.floor(hours);
      }
    }

    if (slots < config.lowScheduleSlotsThreshold) {
      out.push({
        type: "LOW_DOCTOR_SCHEDULE",
        doctorId: d.id,
        doctorName: d.nameRu,
        slotsNext7Days: slots,
      });
    }
  }
  return out;
}
