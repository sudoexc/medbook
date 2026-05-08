/**
 * Detector: LOW_DOCTOR_SCHEDULE.
 *
 * For each active doctor, count the total declared scheduled hours over the
 * next 7 days from `DoctorSchedule` rows. We translate each row to the
 * concrete date(s) within the window, subtract any `DoctorTimeOff` overlap,
 * and divide hours into 1-hour slot units.
 *
 * Action fires when the count falls below `lowScheduleSlotsThreshold` AND
 * the doctor isn't on an open-ended time-off covering the whole window.
 *
 * Severity: `medium`. Assignee defaults to ADMIN (per `defaultAssigneeRole`).
 */
import type { LowDoctorSchedulePayload } from "@/lib/actions/types";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { addDays, startOfUtcDay } from "./_shared";

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

function parseHHmm(value: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

export async function detectLowDoctorSchedule(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<LowDoctorSchedulePayload[]> {
  const windowStart = startOfUtcDay(now);
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
    // Walk the 7-day window day by day; each day has weekday 0..6.
    for (let i = 0; i < 7; i++) {
      const dayStart = addDays(windowStart, i);
      const dayEnd = addDays(dayStart, 1);
      const weekday = dayStart.getUTCDay();
      const rowsForDay = sched.filter((r) => {
        if (r.weekday !== weekday) return false;
        if (r.validFrom && r.validFrom.getTime() > dayEnd.getTime()) return false;
        if (r.validTo && r.validTo.getTime() < dayStart.getTime()) return false;
        return true;
      });
      for (const r of rowsForDay) {
        const s = parseHHmm(r.startTime);
        const e = parseHHmm(r.endTime);
        if (!s || !e) continue;
        const start = new Date(dayStart);
        start.setUTCHours(s.h, s.m, 0, 0);
        const end = new Date(dayStart);
        end.setUTCHours(e.h, e.m, 0, 0);
        let hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
        if (hours <= 0) continue;

        // Subtract any time-off overlap.
        for (const t of offs) {
          const overlapStart = Math.max(t.startAt.getTime(), start.getTime());
          const overlapEnd = Math.min(t.endAt.getTime(), end.getTime());
          if (overlapEnd > overlapStart) {
            hours -= (overlapEnd - overlapStart) / (60 * 60 * 1000);
          }
        }
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
