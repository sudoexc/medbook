/**
 * Phase 16 Wave 3 — Pure helpers for the medication-reminder worker.
 *
 * The reminder worker runs once per hour and needs to answer:
 *   - "is this prescription due in the current tick window?"
 *   - "when is the next tick after `from`?"
 *   - "how many days are left in the active window?"
 *
 * All logic here is timezone-agnostic at the input layer — the caller passes
 * a `now` Date and a `tz` IANA name. We translate `schedule.times[]`
 * (HH:mm strings interpreted in `tz`) to UTC anchors via `Intl.DateTimeFormat`.
 *
 * Design notes:
 *   - The schedule shape is intentionally loose (`{times, days?, startsAt?}`)
 *     so future fields (daysOfWeek, mealRelation) don't require migrations.
 *   - We dedupe by anchoring `scheduledFor` to the start of the local hour —
 *     this matches the worker's hourly tick and the
 *     (prescriptionId, scheduledFor) unique constraint on
 *     `MedicationReminderSend`.
 */

export type PrescriptionScheduleShape = {
  /** Array of HH:mm strings interpreted in the clinic's timezone. */
  times: string[];
  /** Total active days from `startsAt`. Null = open-ended. */
  days?: number | null;
  /** ISO timestamp when the schedule starts. Null = `createdAt`. */
  startsAt?: string | null;
};

export type ParsedSchedule = {
  times: string[];
  days: number | null;
  startsAt: Date;
};

/**
 * Parse a Prisma JSON `schedule` blob. Tolerates partial / malformed input by
 * returning `null` so the worker can skip the row instead of crashing.
 */
export function parseSchedule(
  raw: unknown,
  fallbackStart: Date,
): ParsedSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rawTimes = obj.times;
  if (!Array.isArray(rawTimes)) return null;
  const times: string[] = [];
  for (const t of rawTimes) {
    if (typeof t !== "string") continue;
    if (!/^\d{2}:\d{2}$/.test(t)) continue;
    const [h, m] = t.split(":").map((s) => Number.parseInt(s, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    if (h < 0 || h > 23 || m < 0 || m > 59) continue;
    times.push(t);
  }
  if (times.length === 0) return null;
  const days =
    typeof obj.days === "number" && Number.isFinite(obj.days) && obj.days > 0
      ? Math.floor(obj.days)
      : null;
  const startsAt =
    typeof obj.startsAt === "string"
      ? new Date(obj.startsAt)
      : fallbackStart;
  if (Number.isNaN(startsAt.getTime())) return null;
  return { times, days, startsAt };
}

/**
 * For a given (now, tz) pair return the local-clock hour string `HH:00`.
 * Used to compare against schedule.times[] which are stored as HH:mm in
 * the clinic's timezone.
 */
function localHHmm(now: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(now);
  } catch {
    // Fallback: UTC HH:mm.
    return now.toISOString().slice(11, 16);
  }
}

/** YYYY-MM-DD in `tz`. Used to truncate "now" to a calendar day. */
function localYYYYMMDD(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: tz,
    }).format(now);
    return parts;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Translate `YYYY-MM-DDTHH:mm` interpreted in `tz` to a UTC `Date`. Used to
 * compute the canonical `scheduledFor` anchor for a tick — matches the
 * (prescriptionId, scheduledFor) dedupe key on `MedicationReminderSend`.
 *
 * We approximate by computing the UTC offset for the target moment and
 * subtracting it. Good enough for clinic timezones (single offset switch
 * twice a year for DST regions, none for Asia/Tashkent).
 */
function tzDateToUtc(ymd: string, hhmm: string, tz: string): Date {
  // Build a "naive UTC" timestamp first (the wall-clock interpreted as UTC).
  const naive = new Date(`${ymd}T${hhmm}:00.000Z`);
  if (Number.isNaN(naive.getTime())) return naive;
  // Format that naive timestamp back in `tz` to find the offset.
  let offsetMs = 0;
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    });
    const parts = fmt.formatToParts(naive);
    const pick = (t: string) =>
      Number.parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
    const local = Date.UTC(
      pick("year"),
      pick("month") - 1,
      pick("day"),
      pick("hour"),
      pick("minute"),
    );
    offsetMs = local - naive.getTime();
  } catch {
    offsetMs = 0;
  }
  return new Date(naive.getTime() - offsetMs);
}

/**
 * Is the prescription due during the tick window that contains `now`?
 *
 * "Due" means: an entry in `schedule.times[]` matches the local HH part of
 * `now` AND the schedule's active window covers `now`.
 *
 * Returns the canonical UTC anchor for the tick, or null if not due. The
 * worker uses the anchor as the unique `(prescriptionId, scheduledFor)` key.
 */
export function isPrescriptionDueInWindow(
  schedule: ParsedSchedule,
  now: Date,
  tz: string,
): { dueAt: Date } | null {
  // Window guard.
  if (now.getTime() < schedule.startsAt.getTime()) return null;
  if (schedule.days !== null) {
    const endMs =
      schedule.startsAt.getTime() + schedule.days * 24 * 60 * 60 * 1000;
    if (now.getTime() >= endMs) return null;
  }
  const hhmm = localHHmm(now, tz);
  const hourPart = hhmm.slice(0, 2);
  // Match entries in `times[]` whose hour equals the current local hour.
  const match = schedule.times.find((t) => t.slice(0, 2) === hourPart);
  if (!match) return null;
  const ymd = localYYYYMMDD(now, tz);
  const dueAt = tzDateToUtc(ymd, match, tz);
  return { dueAt };
}

/**
 * Days remaining in the schedule (0 = today is the last day, negative =
 * already finished). Null if the schedule is open-ended.
 */
export function daysRemaining(
  schedule: ParsedSchedule,
  now: Date,
): number | null {
  if (schedule.days === null) return null;
  const endMs =
    schedule.startsAt.getTime() + schedule.days * 24 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.ceil((endMs - now.getTime()) / dayMs);
}

/**
 * Compute the UTC anchor of the next scheduled dose strictly after `from`.
 * Used by the patient dashboard to render "next dose at HH:mm".
 *
 * Returns null if `from` is past the active window. We sweep up to 7 days
 * forward as a safety bound.
 */
export function nextTickAt(
  schedule: ParsedSchedule,
  from: Date,
  tz: string,
): Date | null {
  const dayMs = 24 * 60 * 60 * 1000;
  // Sort times ascending so the same-day search picks the earliest future tick.
  const sorted = [...schedule.times].sort();
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const probe = new Date(from.getTime() + dayOffset * dayMs);
    const ymd = localYYYYMMDD(probe, tz);
    for (const t of sorted) {
      const candidate = tzDateToUtc(ymd, t, tz);
      if (candidate.getTime() <= from.getTime()) continue;
      // Window guard.
      if (candidate.getTime() < schedule.startsAt.getTime()) continue;
      if (schedule.days !== null) {
        const endMs = schedule.startsAt.getTime() + schedule.days * dayMs;
        if (candidate.getTime() >= endMs) return null;
      }
      return candidate;
    }
  }
  return null;
}
