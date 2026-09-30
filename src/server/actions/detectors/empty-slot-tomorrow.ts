/**
 * Detector: EMPTY_SLOT_TOMORROW.
 *
 * For each active doctor with declared schedule slots tomorrow, find blocks
 * that fall within peak hours and have no overlapping appointment booked.
 * Group consecutive empty schedule rows into a single block; one action per
 * (doctor, contiguous block) — capped at the top 5 by estimated revenue loss
 * per clinic so a doctor with a fully empty day doesn't drown out everything
 * else.
 *
 * Severity:
 *   - high     when estimatedRevenueLossUzs > 100_000_000 tiins (1M UZS)
 *   - medium   otherwise
 *
 * Estimated revenue: average of the doctor's PAID appointment revenue over
 * the trailing 90 days, multiplied by the number of empty hours in the block.
 * If we have no history, we fall back to `pricePerVisit` (in major UZS, x100
 * to tiins) and finally to 0.
 *
 * Schedule slot semantics: a `DoctorSchedule` row is `(weekday, startTime,
 * endTime)` in `HH:mm` format, scoped to the clinic timezone. We use the
 * clinic's tz to compute "tomorrow 00:00 → 24:00 local" and slice the
 * doctor's working time into blocks of empty time. Working time is the one
 * rule of `workingIntervalsOn`: rows valid tomorrow (`validFrom` / `validTo`)
 * with every `DoctorTimeOff` cut out (audit AC-11). The weekday's rows alone
 * turned a doctor on leave into a full free day: «Свободный слот завтра в
 * 09:00, возможные потери 2 700 000 сум», and reception rang patients to
 * book them with a doctor who would not be there.
 */
import { defaultSeverity, type EmptySlotTomorrowPayload } from "@/lib/actions/types";
import {
  tashkentComponents,
  toTashkentDate,
} from "@/lib/booking-validation";
import { workingIntervalsOn } from "@/lib/doctor-working-windows";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { addDays, startOfClinicDay } from "./_shared";

type ScheduleRow = {
  doctorId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom?: Date | null;
  validTo?: Date | null;
};
type TimeOffRow = {
  doctorId: string;
  startAt: Date;
  endAt: Date;
};
type DoctorRow = {
  id: string;
  nameRu: string;
  specializationRu: string;
  pricePerVisit: number | null;
  isActive: boolean;
};
type ApptRow = {
  doctorId: string;
  date: Date;
  endDate: Date;
};

/**
 * UTC instant for `tomorrow at HH:mm` **Tashkent wall clock** — schedule
 * rows store clinic wall-clock strings, so anchoring them at UTC hours
 * shifted every block by 5h on the prod box.
 */
function atTomorrow(now: Date, hh: number, mm: number): Date {
  const tomorrow = tashkentComponents(addDays(now, 1)).date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return toTashkentDate(tomorrow, `${pad(hh)}:${pad(mm)}`);
}

export async function detectEmptySlotTomorrow(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<EmptySlotTomorrowPayload[]> {

  const tomorrowStart = startOfClinicDay(addDays(now, 1));
  const tomorrowEnd = addDays(tomorrowStart, 1);
  const tomorrowDate = tashkentComponents(tomorrowStart).date;
  // Sun=0..Sat=6 in the *clinic's* civil day — same convention as the schema.
  const weekday = tashkentComponents(tomorrowStart).dow;

  const doctors = (await prisma.doctor.findMany({
    where: { isActive: true },
    select: {
      id: true,
      nameRu: true,
      specializationRu: true,
      pricePerVisit: true,
      isActive: true,
    },
  })) as DoctorRow[];
  if (doctors.length === 0) return [];

  const doctorIds = doctors.map((d) => d.id);

  const schedules = (await prisma.doctorSchedule.findMany({
    where: {
      doctorId: { in: doctorIds },
      weekday,
      isActive: true,
    },
    select: {
      doctorId: true,
      weekday: true,
      startTime: true,
      endTime: true,
      validFrom: true,
      validTo: true,
    },
  })) as ScheduleRow[];
  if (schedules.length === 0) return [];

  // Leave, sick days, a conference: any time off that touches tomorrow.
  const timeOffs = (await prisma.doctorTimeOff.findMany({
    where: {
      doctorId: { in: doctorIds },
      startAt: { lt: tomorrowEnd },
      endAt: { gt: tomorrowStart },
    },
    select: { doctorId: true, startAt: true, endAt: true },
  })) as TimeOffRow[];

  // Pull tomorrow's appointments (any non-cancelled status counts as
  // "occupies the slot").
  const appts = (await prisma.appointment.findMany({
    where: {
      doctorId: { in: doctorIds },
      date: { gte: tomorrowStart, lt: tomorrowEnd },
      status: { notIn: ["CANCELLED"] },
    },
    select: { doctorId: true, date: true, endDate: true },
  })) as ApptRow[];

  // 90-day historical revenue for fallback estimation.
  const historyStart = addDays(now, -90);
  const paid = (await prisma.appointment.findMany({
    where: {
      doctorId: { in: doctorIds },
      status: "COMPLETED",
      completedAt: { gte: historyStart, lte: now },
      priceFinal: { gt: 0 },
    },
    select: { doctorId: true, priceFinal: true },
  })) as Array<{ doctorId: string; priceFinal: number | null }>;

  const revenueByDoctor = new Map<string, { total: number; count: number }>();
  for (const r of paid) {
    if (!r.priceFinal) continue;
    const cur = revenueByDoctor.get(r.doctorId) ?? { total: 0, count: 0 };
    cur.total += r.priceFinal;
    cur.count += 1;
    revenueByDoctor.set(r.doctorId, cur);
  }

  type Candidate = EmptySlotTomorrowPayload;
  const candidates: Candidate[] = [];

  // Group schedules per doctor and merge contiguous segments.
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

  const apptsByDoctor = new Map<string, ApptRow[]>();
  for (const a of appts) {
    const arr = apptsByDoctor.get(a.doctorId) ?? [];
    arr.push(a);
    apptsByDoctor.set(a.doctorId, arr);
  }

  for (const doctor of doctors) {
    const rows = schedByDoctor.get(doctor.id);
    if (!rows || rows.length === 0) continue;

    // Tomorrow's working time: valid rows, merged, time off cut out. None
    // (a day off, a schedule not valid tomorrow, leave) → nothing is free.
    type Block = { start: Date; end: Date };
    const merged: Block[] = workingIntervalsOn(
      rows,
      tomorrowDate,
      offsByDoctor.get(doctor.id) ?? [],
    );
    if (merged.length === 0) continue;

    // Subtract appointments to derive empty sub-blocks.
    const dApps = (apptsByDoctor.get(doctor.id) ?? [])
      .slice()
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const empty: Block[] = [];
    for (const block of merged) {
      let cursor = block.start.getTime();
      const blockEnd = block.end.getTime();
      for (const a of dApps) {
        const aStart = a.date.getTime();
        const aEnd = a.endDate.getTime();
        if (aEnd <= cursor || aStart >= blockEnd) continue;
        if (aStart > cursor) {
          empty.push({ start: new Date(cursor), end: new Date(aStart) });
        }
        cursor = Math.max(cursor, aEnd);
        if (cursor >= blockEnd) break;
      }
      if (cursor < blockEnd) {
        empty.push({ start: new Date(cursor), end: new Date(blockEnd) });
      }
    }
    if (empty.length === 0) continue;

    // Filter to peak hours window. We clamp each empty block to the peak
    // window before producing a candidate.
    const peakStartHour = config.emptySlotPeakHoursStart;
    const peakEndHour = config.emptySlotPeakHoursEnd;
    const peakStart = atTomorrow(now, peakStartHour, 0);
    const peakEnd = atTomorrow(now, peakEndHour, 0);

    for (const e of empty) {
      const sMs = Math.max(e.start.getTime(), peakStart.getTime());
      const eMs = Math.min(e.end.getTime(), peakEnd.getTime());
      if (eMs <= sMs) continue;
      const slotStart = new Date(sMs);
      const slotEnd = new Date(eMs);
      const hours = (eMs - sMs) / (60 * 60 * 1000);

      // Estimate revenue loss in tiins (UZS minor units).
      const revInfo = revenueByDoctor.get(doctor.id);
      let avgVisitTiins = 0;
      if (revInfo && revInfo.count > 0) {
        // priceFinal is already in tiins.
        avgVisitTiins = Math.round(revInfo.total / revInfo.count);
      } else if (doctor.pricePerVisit && doctor.pricePerVisit > 0) {
        // pricePerVisit is also stored in tiins per `Service.priceBase`
        // convention used elsewhere (Phase 9c pricing engine).
        avgVisitTiins = doctor.pricePerVisit;
      }
      const estimatedRevenueLossUzs = Math.round(avgVisitTiins * hours);

      candidates.push({
        type: "EMPTY_SLOT_TOMORROW",
        doctorId: doctor.id,
        doctorName: doctor.nameRu,
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        specialty: doctor.specializationRu,
        estimatedRevenueLossUzs,
      });
    }
  }

  // Cap to top 5 by revenue loss to keep noise down per clinic.
  candidates.sort(
    (a, b) => b.estimatedRevenueLossUzs - a.estimatedRevenueLossUzs,
  );
  return candidates.slice(0, 5);
}

/** Severity rule, exported for the engine to call. */
export function severityForEmptySlot(
  payload: EmptySlotTomorrowPayload,
): "medium" | "high" {
  if (payload.estimatedRevenueLossUzs > 100_000_000) return "high";
  // Default for EMPTY_SLOT_TOMORROW is "high" in defaultSeverity, but the
  // detector spec asks for "medium" baseline that escalates to "high" once
  // revenue exceeds 1M UZS — honor that via an explicit override.
  void defaultSeverity; // keep import hint for future tweaks
  return "medium";
}
