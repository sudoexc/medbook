/**
 * Pure planning for scripts/subscription-lifecycle-dryrun.ts (review of
 * 79422ba). No database here, so the unit tests pin it:
 *
 *   - `forecastClinic`: what the subscription scheduler will do to a
 *     clinic's row (the first tick, then each later step if nobody acts)
 *     and which limits the API quota guard applies before and after;
 *   - `quotaOutcomes`: what `ensureQuotaForApi` answers for those limits and
 *     the clinic's current counts;
 *   - `dailyCoreProblems`: why the clinic whose desk must keep working is
 *     not safe under both (empty when it is);
 *   - `planPinOpenEnded`: the write that makes it safe, an open-ended ACTIVE
 *     on a plan that is not Basic.
 *
 * The rules themselves are the app's (`lifecycleProjection`,
 * `planContextOf`, `guardCounts`, `evaluateLimit`), not copies.
 */
import {
  lifecycleProjection,
  type AutoStep,
  type SubscriptionState,
  type SubscriptionStatus,
  type SubscriptionWrite,
} from "../src/server/platform/subscription-lifecycle";
import {
  evaluateLimit,
  guardCounts,
  planContextOf,
  type GuardQuota,
  type PlanContext,
} from "../src/server/billing/quota-rule";

export type PlanRow = {
  id: string;
  slug: string;
  isActive: boolean;
  features: unknown;
};

export type SubscriptionRowWithPlan = SubscriptionState & {
  id: string;
  plan: PlanRow;
};

export type ClinicRow = {
  id: string;
  slug: string;
  nameRu: string;
  active: boolean;
  subscription: SubscriptionRowWithPlan | null;
};

export const GUARD_QUOTAS: readonly GuardQuota[] = [
  "maxPatients",
  "maxAppointmentsPerMonth",
];

export type QuotaOutcome =
  | { quota: GuardQuota; counted: false }
  | {
      quota: GuardQuota;
      counted: true;
      current: number;
      max: number;
      blocks: boolean;
    };

/** What `ensureQuotaForApi` answers for these limits and these counts. */
export function quotaOutcomes(
  ctx: PlanContext,
  counts: Record<GuardQuota, number>,
): QuotaOutcome[] {
  return GUARD_QUOTAS.map((quota) => {
    if (!guardCounts(ctx, quota)) return { quota, counted: false };
    const max = ctx.flags[quota];
    const current = counts[quota];
    const r = evaluateLimit(current, max, true, quota);
    return { quota, counted: true, current, max, blocks: !r.ok && r.kind === "block" };
  });
}

export type ClinicForecast = {
  /** Every automatic step if nobody acts, the first tick's included. */
  steps: Array<{ at: Date; step: AutoStep }>;
  /** The step the first tick after the deploy takes, or null. */
  firstTick: AutoStep | null;
  /** Where the row ends up; null for a clinic without a subscription. */
  finalStatus: SubscriptionStatus | null;
  /** The limits the quota guard applies today, and after the last step. */
  nowContext: PlanContext;
  finalContext: PlanContext;
};

export function forecastClinic(row: ClinicRow, now: Date): ClinicForecast {
  const sub = row.subscription;
  if (!sub) {
    const ctx = planContextOf(null);
    return { steps: [], firstTick: null, finalStatus: null, nowContext: ctx, finalContext: ctx };
  }
  const steps = lifecycleProjection(sub, now);
  const first = steps[0];
  const last = steps[steps.length - 1];
  const finalStatus = last ? last.step.to : sub.status;
  return {
    steps,
    firstTick: first && first.at.getTime() === now.getTime() ? first.step : null,
    finalStatus,
    nowContext: planContextOf(sub),
    finalContext: planContextOf({ status: finalStatus, plan: sub.plan }),
  };
}

/**
 * What keeps a subscription out of reach of the scheduler and the quota
 * guard: ACTIVE (TRIAL and PAST_DUE run out, CANCELLED has Basic limits),
 * no paid-period end (the scheduler ends it on that date) and a plan that
 * is not Basic (the guard counts and blocks only Basic).
 */
function subscriptionProblems(sub: SubscriptionRowWithPlan): string[] {
  const out: string[] = [];
  if (sub.status !== "ACTIVE") out.push(`status is ${sub.status}, not ACTIVE`);
  if (sub.currentPeriodEndsAt) {
    out.push(
      `currentPeriodEndsAt is ${sub.currentPeriodEndsAt.toISOString()}: the scheduler moves it to PAST_DUE then`,
    );
  }
  if (sub.plan.slug === "basic") {
    out.push("plan is basic: the quota guard counts and blocks it");
  }
  return out;
}

/**
 * Why the clinic whose desk must keep working (NeuroFax) is not safe under
 * the new lifecycle and quota guard; empty when it is. Besides the
 * subscription, the clinic itself must be active: SEC-10 locks the staff
 * of an inactive clinic out at sign-in.
 */
export function dailyCoreProblems(row: ClinicRow): string[] {
  const out: string[] = [];
  if (!row.active) out.push("Clinic.active is false: its staff cannot sign in (SEC-10)");
  if (!row.subscription) {
    out.push("no subscription: Basic limits apply and the quota guard blocks at once");
    return out;
  }
  return [...out, ...subscriptionProblems(row.subscription)];
}

export type PinPlan =
  | { ok: true; action: "none" }
  | { ok: true; action: "create"; planId: string }
  | { ok: true; action: "update"; data: SubscriptionWrite }
  | { ok: false; reason: string };

/**
 * The write that pins a clinic to an open-ended ACTIVE subscription, the
 * state the scheduler never touches and the guard never counts. `plan` is
 * the plan to pin it on: the one named by PLAN=<slug>, or the row's own
 * when none is named. Nothing to do when the row is already there. It never
 * touches `Clinic.active`: switching a clinic off is the owner's decision,
 * the dry run only reports it.
 */
export function planPinOpenEnded(row: ClinicRow, plan: PlanRow | null): PinPlan {
  const sub = row.subscription;
  if (!plan) {
    return {
      ok: false,
      reason: sub
        ? "plan_not_found: no plan with that slug"
        : "plan_required: the clinic has no subscription, name a plan with PLAN=<slug>",
    };
  }
  // Already there (a retired plan it still runs on included): a second run
  // writes nothing.
  if (sub && plan.id === sub.planId && subscriptionProblems(sub).length === 0) {
    return { ok: true, action: "none" };
  }
  if (plan.slug === "basic") {
    return {
      ok: false,
      reason: "plan_basic: Basic is the plan the quota guard blocks, name another with PLAN=<slug>",
    };
  }
  if (!plan.isActive) return { ok: false, reason: `plan_inactive: ${plan.slug} is switched off` };
  if (!sub) return { ok: true, action: "create", planId: plan.id };
  return {
    ok: true,
    action: "update",
    data: {
      status: "ACTIVE",
      currentPeriodEndsAt: null,
      graceEndsAt: null,
      cancelledAt: null,
      ...(plan.id !== sub.planId ? { planId: plan.id } : {}),
    },
  };
}
