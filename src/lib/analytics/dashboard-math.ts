/**
 * Phase 18 Wave 2 — pure helpers shared by the new analytics dashboards.
 *
 * Lives in `src/lib/analytics/` (not `src/server/analytics/`) so the client
 * dashboard components can import them without dragging Prisma into the
 * browser bundle. All functions are pure and DB-less.
 */

import {
  addTashkentDays,
  tashkentDateOf,
  tashkentDayWindow,
} from "@/lib/tashkent-time";

/** Doctor-performance preset windows shown in the toolbar. */
export type DoctorPerfRangeKind = "30d" | "90d" | "ytd" | "custom";

export interface DoctorPerfRange {
  /** Inclusive lower bound, midnight of a Tashkent day. */
  from: Date;
  /** Exclusive upper bound, midnight of the Tashkent day after the last one. */
  to: Date;
  kind: DoctorPerfRangeKind;
}

/** Midnight (Tashkent) starting the civil day `ymd`. */
function tashkentMidnight(ymd: string): Date {
  return tashkentDayWindow(ymd).from;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A picker value as a Tashkent civil day. `<input type="date">` hands us
 * YYYY-MM-DD, which is the clinic's day as is; an instant (an older caller)
 * is folded onto the Tashkent day it falls on.
 */
function pickerDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (YMD.test(value)) {
    return Number.isNaN(Date.parse(`${value}T00:00:00+05:00`)) ? null : value;
  }
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : tashkentDateOf(at);
}

/**
 * Resolve a doctor-performance toolbar selection into a [from, to) range of
 * whole Tashkent days, today included (audit AN-03).
 *
 * `30d` and `90d` are trailing windows of n days ending today. `ytd` runs from
 * Jan 1 of the clinic's current year. `custom` takes the two picker days, both
 * inclusive: a single day (from = to) is a valid range. The bounds used to be
 * UTC midnights, so between 00:00 and 05:00 in Tashkent «today» was still
 * yesterday, and a picked end day was cut at 05:00 local time.
 */
export function resolveDoctorPerfRange(
  kind: DoctorPerfRangeKind,
  now: Date,
  custom?: { from?: string | null; to?: string | null } | null,
): DoctorPerfRange {
  const today = tashkentDateOf(now);
  const tomorrowMidnight = tashkentMidnight(addTashkentDays(today, 1));

  if (kind === "30d") {
    return {
      from: tashkentMidnight(addTashkentDays(today, -29)),
      to: tomorrowMidnight,
      kind,
    };
  }
  if (kind === "90d") {
    return {
      from: tashkentMidnight(addTashkentDays(today, -89)),
      to: tomorrowMidnight,
      kind,
    };
  }
  if (kind === "ytd") {
    return {
      from: tashkentMidnight(`${today.slice(0, 4)}-01-01`),
      to: tomorrowMidnight,
      kind,
    };
  }

  // custom — fall through to 30d if the bounds are missing/malformed.
  const f = pickerDay(custom?.from);
  const t = pickerDay(custom?.to);
  if (!f || !t || f > t) {
    return resolveDoctorPerfRange("30d", now);
  }
  return {
    from: tashkentMidnight(f),
    // Inclusive end day from the picker → exclusive upper bound for the query.
    to: tashkentMidnight(addTashkentDays(t, 1)),
    kind: "custom",
  };
}

/**
 * Query string for `/api/crm/analytics/doctors` for a toolbar selection, or
 * null while a custom range is incomplete or inverted: nothing should be
 * fetched (and nothing shown under the «Период» label) until both days make
 * sense. Part of the query key, so every selection loads its own rows.
 */
export function doctorPerfQueryString(
  kind: DoctorPerfRangeKind,
  now: Date,
  custom?: { from?: string | null; to?: string | null } | null,
): string | null {
  if (kind === "custom") {
    const f = pickerDay(custom?.from);
    const t = pickerDay(custom?.to);
    if (!f || !t || f > t) return null;
  }
  const range = resolveDoctorPerfRange(kind, now, custom);
  return new URLSearchParams({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    limit: "200",
  }).toString();
}

/** Cohort heatmap default range — trailing 12 months including current. */
export interface CohortRangeMonths {
  /** Inclusive cohort-month YYYY-MM key — earliest cohort to render. */
  fromMonth: string;
  /** Inclusive cohort-month YYYY-MM key — latest cohort to render. */
  toMonth: string;
  /** monthCount inclusive (so trailing-12 → 12). */
  monthCount: number;
}

function ymKeyFromUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function trailingMonths(now: Date, monthCount: number): CohortRangeMonths {
  const safeCount = Math.max(1, Math.min(monthCount, 24));
  const toMonth = ymKeyFromUtc(now);
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (safeCount - 1), 1),
  );
  return {
    fromMonth: ymKeyFromUtc(start),
    toMonth,
    monthCount: safeCount,
  };
}

/**
 * Project the month-end revenue from MTD-collected revenue using a linear
 * extrapolation (`mtd * totalDays / dayOfMonth`). Returns the original `mtd`
 * when `dayOfMonth <= 0` (pathological clock state).
 *
 * Centralised here so the financial dashboard and any future report can
 * agree on the projection formula and the test harness covers it once.
 */
export function projectMonthEnd(
  mtdTiins: number,
  now: Date,
): { projectedTiins: number; dayOfMonth: number; daysInMonth: number } {
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  if (dayOfMonth <= 0) {
    return { projectedTiins: mtdTiins, dayOfMonth, daysInMonth };
  }
  // Multiply before dividing so we don't accumulate float-rounding error on
  // the day-fraction. The product fits comfortably in JS Number for any
  // realistic clinic MTD revenue (max ~1e15 tiins ≈ 100 trillion sum).
  return {
    projectedTiins: Math.round((mtdTiins * daysInMonth) / dayOfMonth),
    dayOfMonth,
    daysInMonth,
  };
}

/**
 * Compute the top/bottom-quartile thresholds for a numeric series. Used by
 * the doctor scoreboard to tint the top/bottom 25 % rows post-filter.
 *
 * The thresholds are the values at the 75th and 25th percentile. A row is
 * "top" iff its value ≥ p75 and "bottom" iff its value ≤ p25. When fewer
 * than 4 rows are present we return null thresholds (banding the visible
 * set into quartiles isn't meaningful below n=4).
 */
export interface QuartileBand {
  topThreshold: number | null;
  bottomThreshold: number | null;
}

export function computeQuartileBand(values: number[]): QuartileBand {
  if (values.length < 4) {
    return { topThreshold: null, bottomThreshold: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pickAt = (frac: number): number => {
    const idx = Math.max(
      0,
      Math.min(sorted.length - 1, Math.floor(sorted.length * frac)),
    );
    return sorted[idx]!;
  };
  return {
    bottomThreshold: pickAt(0.25),
    // p75 — first index whose rank ≥ 75 % puts the row inside the top band.
    topThreshold: pickAt(0.75),
  };
}

/** Classify a single row's value against pre-computed quartile thresholds. */
export function bandOf(
  value: number,
  band: QuartileBand,
): "top" | "bottom" | "mid" {
  if (band.topThreshold === null || band.bottomThreshold === null) return "mid";
  if (value >= band.topThreshold) return "top";
  if (value <= band.bottomThreshold) return "bottom";
  return "mid";
}
