/**
 * Phase 18 Wave 2 — pure helpers shared by the new analytics dashboards.
 *
 * Lives in `src/lib/analytics/` (not `src/server/analytics/`) so the client
 * dashboard components can import them without dragging Prisma into the
 * browser bundle. All functions are pure and DB-less.
 */

/** Doctor-performance preset windows shown in the toolbar. */
export type DoctorPerfRangeKind = "30d" | "90d" | "ytd" | "custom";

export interface DoctorPerfRange {
  /** Inclusive lower bound, midnight UTC. */
  from: Date;
  /** Exclusive upper bound, midnight UTC. */
  to: Date;
  kind: DoctorPerfRangeKind;
}

function utcMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/**
 * Resolve a doctor-performance toolbar selection into a [from, to) range.
 *
 * `30d` and `90d` are sliding trailing windows (n full days back). `ytd` is
 * Jan 1 of the current year through tomorrow-midnight. `custom` requires
 * both `from` and `to`; the returned `to` is bumped by 1 day to make it
 * exclusive (the toolbar exposes inclusive dates to the user).
 */
export function resolveDoctorPerfRange(
  kind: DoctorPerfRangeKind,
  now: Date,
  custom?: { from?: string | null; to?: string | null } | null,
): DoctorPerfRange {
  const todayMidnight = utcMidnight(now);
  const tomorrowMidnight = new Date(todayMidnight.getTime() + 24 * 3600 * 1000);

  if (kind === "30d") {
    const from = new Date(todayMidnight.getTime() - 29 * 24 * 3600 * 1000);
    return { from, to: tomorrowMidnight, kind };
  }
  if (kind === "90d") {
    const from = new Date(todayMidnight.getTime() - 89 * 24 * 3600 * 1000);
    return { from, to: tomorrowMidnight, kind };
  }
  if (kind === "ytd") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { from, to: tomorrowMidnight, kind };
  }

  // custom — fall through to 30d if the bounds are missing/malformed.
  const f = custom?.from ? new Date(custom.from) : null;
  const t = custom?.to ? new Date(custom.to) : null;
  if (
    !f ||
    !t ||
    Number.isNaN(f.getTime()) ||
    Number.isNaN(t.getTime()) ||
    f >= t
  ) {
    return resolveDoctorPerfRange("30d", now);
  }
  return {
    from: utcMidnight(f),
    // Inclusive `to` from the picker → exclusive upper bound for the query.
    to: new Date(utcMidnight(t).getTime() + 24 * 3600 * 1000),
    kind: "custom",
  };
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
