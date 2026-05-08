/**
 * No-show risk (pure, client-safe).
 *
 * Phase 10 introduced a scalar Laplace-smoothed no-show probability with
 * three situational bumps (first-visit, unconfirmed-reminder<24h, far-future).
 * Phase 14 (Revenue Engines, Wave 1) refactors this into a *structured*
 * breakdown — each contribution is exposed individually for an upcoming
 * appointment-card tooltip and for analytics — without changing the aggregate
 * score for any existing input. Backward-compatible: the returned object
 * still carries `risk` and `band`, and a thin scalar export
 * `computeNoShowRiskScore()` is provided for callers that only want a number.
 *
 * Aggregate formula (unchanged from Phase 10):
 *
 *   score = clamp01(
 *     historyRisk           // = (noShows + 1) / (totalVisits + 2)
 *     + firstVisitBump      // = 0.10 if isFirstVisit else 0
 *     + unconfirmedBump     // = 0.10 if hasUnconfirmedReminder && hours<24
 *     + farFutureBump       // = 0.05 if hoursToAppointment > 168
 *     + dayOfWeekBump       // = optional small adjustment, default 0
 *   )
 *
 * Banding (unchanged):
 *   < 0.15  → "low"
 *   < 0.35  → "med"
 *   else    → "high"
 *
 * Confidence (new in Phase 14, derived from history sample size):
 *   totalVisits < 3   → "low"
 *   totalVisits < 10  → "medium"
 *   else              → "high"
 *
 * Pure: zero imports. Used by the receptionist queue scoring, the
 * NO_SHOW_RISK_HIGH detector, and the patient-card dashboard.
 */

export interface NoShowInput {
  totalVisits: number;
  noShows: number;
  hasUnconfirmedReminder: boolean;
  hoursToAppointment: number;
  isFirstVisit: boolean;
  /**
   * Optional 0..6 day-of-week index (0 = Sunday) for the *appointment* date.
   * If omitted, `dayOfWeekBump` is 0 — preserving the Phase 10 aggregate.
   * When present, Saturday (6) and Monday (1) get a tiny +0.02 bump because
   * those days drift more in our historical data; other days are 0.
   */
  dayOfWeek?: number;
}

export type NoShowConfidence = "low" | "medium" | "high";
export type NoShowBand = "low" | "med" | "high";

export interface NoShowFactors {
  /** Smoothed prior no-show ratio: `(noShows+1)/(totalVisits+2)`. */
  historyRisk: number;
  /** +0.10 if `isFirstVisit`, else 0. */
  firstVisitBump: number;
  /** +0.10 if reminder unconfirmed AND `hoursToAppointment < 24`, else 0. */
  unconfirmedBump: number;
  /** +0.05 if `hoursToAppointment > 168` (>1 week), else 0. */
  farFutureBump: number;
  /** Optional small adjustment by weekday; 0 when `dayOfWeek` not supplied. */
  dayOfWeekBump?: number;
}

export interface NoShowRiskBreakdown {
  /** Aggregate risk in [0, 1]. New canonical name; equals `risk`. */
  score: number;
  /** Backward-compat alias of `score`. Existing callers destructure `risk`. */
  risk: number;
  /** Coarse banding for UI badges. */
  band: NoShowBand;
  /** Per-factor contributions; sum (pre-clamp) reproduces `score`. */
  factors: NoShowFactors;
  /** Sample-size confidence in the prediction. */
  confidence: NoShowConfidence;
}

/**
 * Phase-10 compatibility alias. Older code expects `{ risk, band }`.
 */
export type NoShowOutput = NoShowRiskBreakdown;

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function bandOf(score: number): NoShowBand {
  if (score < 0.15) return "low";
  if (score < 0.35) return "med";
  return "high";
}

function confidenceOf(totalVisits: number): NoShowConfidence {
  if (totalVisits < 3) return "low";
  if (totalVisits < 10) return "medium";
  return "high";
}

function dayOfWeekBumpOf(dow: number | undefined): number {
  if (dow === undefined) return 0;
  // Saturday (6) and Monday (1) drift more in our data; everything else 0.
  if (dow === 6 || dow === 1) return 0.02;
  return 0;
}

/**
 * Compute a no-show risk breakdown.
 *
 * The aggregate `score` (and its `risk` alias) is identical to the Phase-10
 * scalar formula whenever `dayOfWeek` is omitted, so detector thresholds and
 * queue penalties continue to fire on the same boundaries.
 */
export function computeNoShowRisk(input: NoShowInput): NoShowRiskBreakdown {
  const total = Math.max(0, input.totalVisits);
  const ns = Math.max(0, Math.min(input.noShows, total));

  const historyRisk = (ns + 1) / (total + 2);
  const firstVisitBump = input.isFirstVisit ? 0.1 : 0;
  const unconfirmedBump =
    input.hasUnconfirmedReminder && input.hoursToAppointment < 24 ? 0.1 : 0;
  const farFutureBump = input.hoursToAppointment > 168 ? 0.05 : 0;
  const dayOfWeekBump = dayOfWeekBumpOf(input.dayOfWeek);

  const raw =
    historyRisk +
    firstVisitBump +
    unconfirmedBump +
    farFutureBump +
    dayOfWeekBump;
  const score = clamp01(raw);

  const factors: NoShowFactors = {
    historyRisk,
    firstVisitBump,
    unconfirmedBump,
    farFutureBump,
  };
  // Only include the optional field when it was actually computed against a
  // supplied dayOfWeek — keeps test snapshots from accreting a `0`.
  if (input.dayOfWeek !== undefined) factors.dayOfWeekBump = dayOfWeekBump;

  return {
    score,
    risk: score,
    band: bandOf(score),
    factors,
    confidence: confidenceOf(total),
  };
}

/**
 * Backward-compatible scalar export. Returns just the aggregate score; thin
 * wrapper around `computeNoShowRisk()` for callers (e.g. analytics jobs)
 * that don't care about the breakdown.
 */
export function computeNoShowRiskScore(input: NoShowInput): number {
  return computeNoShowRisk(input).score;
}
