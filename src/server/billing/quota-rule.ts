/**
 * The plan quota rule without the database: which limits a subscription
 * gives a clinic, whether the API guard counts a quota at all, and how a
 * count compares with its limit.
 *
 * `plan-limits.ts` (the guard the CRM's create routes call) and the
 * pre-deploy dry run (`scripts/subscription-lifecycle-dryrun.ts`) both read
 * it, so what the dry run predicts for a clinic is what the guard will do
 * (review of 79422ba: the guard went live with no way to see its outcome
 * on the real rows first). Kept prisma-free so the script can import it.
 */
import {
  DEFAULT_FLAGS,
  parsePlanFeatures,
  type FeatureFlags,
} from "@/lib/feature-flags";

export type PlanContext = { flags: FeatureFlags; isFreePlan: boolean };

/** The quotas `ensureQuotaForApi` guards. */
export type GuardQuota = "maxPatients" | "maxAppointmentsPerMonth";

export type LimitCheckResult =
  | { ok: true }
  | {
      ok: false;
      kind: "warn" | "block";
      quota: keyof FeatureFlags;
      current: number;
      max: number;
      pctUsed: number;
    };

/**
 * The limits a subscription gives (`sub` with its plan, or null when the
 * clinic has none). `isFreePlan` is the slug-equality check
 * `plan.slug === "basic"`; hard-block applies only to that tier.
 *
 *   - no subscription            → Basic flags, blocks
 *   - TRIAL / ACTIVE / PAST_DUE  → the plan's flags, blocks only on Basic
 *   - CANCELLED                  → Basic flags, blocks (they no longer pay,
 *                                  whatever plan the row still names)
 */
export function planContextOf(
  sub: { status: string; plan: { slug: string; features: unknown } } | null,
): PlanContext {
  if (!sub) return { flags: { ...DEFAULT_FLAGS }, isFreePlan: true };
  switch (sub.status) {
    case "TRIAL":
    case "ACTIVE":
    case "PAST_DUE":
      return {
        flags: parsePlanFeatures(sub.plan.features),
        isFreePlan: sub.plan.slug === "basic",
      };
    case "CANCELLED":
    default:
      return { flags: { ...DEFAULT_FLAGS }, isFreePlan: true };
  }
}

/**
 * Whether the API guard counts this quota at all: only on a plan that
 * blocks, and only when the limit is a real number (`-1` and `0` mean
 * unlimited). Paying plans are never counted, so they never block.
 */
export function guardCounts(ctx: PlanContext, quota: GuardQuota): boolean {
  return ctx.isFreePlan && ctx.flags[quota] > 0;
}

/**
 * The rows a guarded quota counts: live patients, or appointments booked
 * this month (`monthWindow`). One definition for the guard's count and the
 * dry run's, so they cannot disagree.
 */
export function quotaCountQuery(
  clinicId: string,
  quota: GuardQuota,
  now: Date,
):
  | { model: "patient"; where: { clinicId: string; deletedAt: null } }
  | {
      model: "appointment";
      where: { clinicId: string; createdAt: { gte: Date; lt: Date } };
    } {
  if (quota === "maxPatients") {
    return { model: "patient", where: { clinicId, deletedAt: null } };
  }
  const { start, end } = monthWindow(now);
  return {
    model: "appointment",
    where: { clinicId, createdAt: { gte: start, lt: end } },
  };
}

/**
 * Pure helper. Decide warn / block / ok for a given (current, max).
 *
 *   - `max < 0`              → ok (unlimited sentinel)
 *   - `max === 0`            → ok (treated as unlimited too — the quota is
 *                              not enabled on this plan; callers must use a
 *                              boolean flag if they want a hard "off")
 *   - `current < 0.8 * max`  → ok
 *   - `0.8 * max ≤ current < max` → warn
 *   - `current ≥ max`        → block on Free, warn elsewhere
 */
export function evaluateLimit(
  current: number,
  max: number,
  isFreePlan: boolean,
  quota: keyof FeatureFlags = "maxPatients",
): LimitCheckResult {
  if (max < 0 || max === 0) return { ok: true };
  const ratio = current / max;
  const pctUsed = Math.round(ratio * 100);
  if (ratio < 0.8) return { ok: true };
  if (ratio < 1) {
    return { ok: false, kind: "warn", quota, current, max, pctUsed };
  }
  return {
    ok: false,
    kind: isFreePlan ? "block" : "warn",
    quota,
    current,
    max,
    pctUsed,
  };
}

/**
 * Pure helper. Given `now`, return `[start, end)` where `start` is the first
 * instant of the calendar month containing `now` and `end` is the first
 * instant of the next month: the window `maxAppointmentsPerMonth` counts
 * in. Half-open interval matches the way Prisma's `gte` + `lt` operators
 * line up.
 *
 * Uses UTC to keep test fixtures deterministic; the clinic-tz nuance can
 * land in a follow-up wave when the dashboard exposes localized billing
 * cycles. For Wave 1 the goal is consistent counting, not localized boundaries.
 */
export function monthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return { start, end };
}
