/**
 * Pure planning helpers for `seed-prod-demo.ts` (audit G2-01), kept apart
 * so unit tests can pin them without a database.
 *
 * What the audit found in the old seed: 540 patients instead of the 30 its
 * header promised, a fresh future booking per patient on every run, hours
 * picked with `setHours` in a UTC container (so 14:00–22:00 in Tashkent,
 * after most shifts end), a random cabinet unrelated to the doctor, WALKIN
 * "bookings" invisible on both reception lanes, an empty `time` column and
 * nothing marking any of it as demo. Everything below exists to make the
 * opposite true and checkable.
 */
import {
  tashkentComponents,
  toTashkentDate,
} from "../src/lib/booking-validation";

/** How many demo patients the seed maintains. The header promised 30. */
export const DEMO_COUNT = 30;

/** Marker on every row the seed writes, so demo data can be told apart. */
export const DEMO_TAG = "demo-seed";
/** Appointment.notes value (staff-only field). */
export const DEMO_APPOINTMENT_NOTE = `[${DEMO_TAG}]`;
/** Payment.externalRef value; idempotencyKey is `${DEMO_TAG}:<appointmentId>`. */
export const DEMO_PAYMENT_REF = DEMO_TAG;

/**
 * Demo phone numbers: +998 00 100 XX XX. Operator code 00 is not assigned
 * in Uzbekistan, so no real patient can own one of these numbers. (The old
 * range +998 99 910 XX XX is a live Beeline block: a real patient could sit
 * in it, and a range match is no proof a row is demo.)
 */
export function demoPhone(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i > 9999) {
    throw new RangeError(`demo index out of range: ${i}`);
  }
  return `+99800100${String(i).padStart(4, "0")}`;
}

/**
 * Schedule-lane channels only. WALKIN is the live-queue discriminator: a
 * "booking" carrying it reserves no slot and disappears from both reception
 * panels (docs/TZ-two-lanes.md).
 */
export const DEMO_CHANNELS = ["PHONE", "TELEGRAM", "WEBSITE"] as const;

export type ScheduleRow = {
  weekday: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
  validFrom?: Date | null;
  validTo?: Date | null;
};

/** Grid step for slot starts, same as the booking grid. */
const SLOT_STEP_MIN = 20;

function hhmmToMin(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minToHhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Tashkent calendar day `offset` days from `now`, as "YYYY-MM-DD". */
export function tashkentDayString(now: Date, offset: number): string {
  const shifted = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
  return tashkentComponents(shifted).date;
}

export type PlannedSlot = {
  /** UTC instant of the visit start. */
  date: Date;
  /** Tashkent wall clock "HH:mm", the Appointment.time column. */
  time: string;
  endDate: Date;
};

/**
 * Every slot start (on the booking grid) that fits `durationMin` inside the
 * doctor's shift on the Tashkent day `dayStr`. Empty when the doctor does not
 * work that day. Times are Tashkent wall clock converted with
 * `toTashkentDate`, never `setHours` on a UTC box.
 */
export function slotsForDay(
  schedules: ScheduleRow[],
  dayStr: string,
  durationMin: number,
): PlannedSlot[] {
  const dayStart = toTashkentDate(dayStr, "00:00");
  const weekday = tashkentComponents(dayStart).dow;
  const out: PlannedSlot[] = [];
  for (const s of schedules) {
    if (!s.isActive || s.weekday !== weekday) continue;
    if (s.validFrom && dayStart < s.validFrom) continue;
    if (s.validTo && dayStart > s.validTo) continue;
    const from = hhmmToMin(s.startTime);
    const to = hhmmToMin(s.endTime);
    if (from === null || to === null) continue;
    for (let m = from; m + durationMin <= to; m += SLOT_STEP_MIN) {
      const time = minToHhmm(m);
      const date = toTashkentDate(dayStr, time);
      out.push({
        date,
        time,
        endDate: new Date(date.getTime() + durationMin * 60_000),
      });
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Candidate slots for one demo visit, in the order to try them: past visits
 * walk back from yesterday over `horizonDays`, future ones forward from
 * today, keeping only slots strictly after `now`. The caller tries them in
 * order and takes the first the database accepts (no overlap).
 */
export function candidateSlots(args: {
  kind: "past" | "future";
  schedules: ScheduleRow[];
  durationMin: number;
  now: Date;
  horizonDays?: number;
  /** Rotates the start day so patients spread over the horizon. */
  seed?: number;
}): PlannedSlot[] {
  const horizon = args.horizonDays ?? (args.kind === "past" ? 30 : 7);
  const start = (args.seed ?? 0) % horizon;
  const out: PlannedSlot[] = [];
  for (let k = 0; k < horizon; k += 1) {
    const step = (start + k) % horizon;
    const offset = args.kind === "past" ? -1 - step : step;
    const day = tashkentDayString(args.now, offset);
    for (const slot of slotsForDay(args.schedules, day, args.durationMin)) {
      if (args.kind === "future" && slot.date <= args.now) continue;
      if (args.kind === "past" && slot.endDate >= args.now) continue;
      out.push(slot);
    }
  }
  return out;
}
