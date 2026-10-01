/**
 * The platform subscription lifecycle, in one place (audit G5-01, G5-02,
 * G5-03).
 *
 *   TRIAL ──trialEndsAt──▶ PAST_DUE ──graceEndsAt──▶ CANCELLED
 *   ACTIVE ─currentPeriodEndsAt─▶ PAST_DUE
 *
 * What was wrong. Trials ended in PAST_DUE and stayed there forever with
 * full features; ACTIVE never ended because nothing set
 * `currentPeriodEndsAt`. «Продлить триал» moved the date but left a PAST_DUE
 * clinic PAST_DUE (banner still up, toast said «продлён»), the row menu's
 * «Пробный +30 дней» behaved differently from the billing page's button,
 * «Восстановить (14 дн)» turned any clinic, a paying one included, into a
 * 14-day trial, and four routes each created a missing subscription with
 * their own plan and trial length the first time anyone looked.
 *
 * Now:
 *   - a subscription is created with the clinic (`createSubscription`), with
 *     an explicit plan and trial length; nothing creates one implicitly;
 *   - extending a trial (`planExtendTrial`) is one rule for both buttons: a
 *     PAST_DUE or CANCELLED subscription is back in TRIAL until the new date,
 *     an ACTIVE one is refused; `expectedTrialEndsAt` makes a double click a
 *     409 instead of a second month;
 *   - suspending (`planCancel`) records what the subscription was, and
 *     restoring (`planRestore`) is only for a CANCELLED subscription and
 *     brings that back, never a fresh trial;
 *   - the scheduler (`nextAutoStep`) closes every state: an expired trial or
 *     paid period becomes PAST_DUE with a grace period, an expired grace
 *     period becomes CANCELLED.
 * NeuroFax runs ACTIVE with no `currentPeriodEndsAt`: an open-ended
 * subscription set by the platform owner, which no rule here ends.
 *
 * The planners are pure; the routes and the scheduler load, plan, write and
 * audit.
 */

export const DEFAULT_TRIAL_DAYS = 30;
export const EXTEND_TRIAL_DAYS = 30;
/** How long PAST_DUE keeps the plan's features before it is cancelled. */
export const GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

export type SubscriptionState = {
  status: SubscriptionStatus;
  planId: string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  graceEndsAt: Date | null;
  cancelledAt: Date | null;
};

export type SubscriptionWrite = Partial<
  Pick<
    SubscriptionState,
    | "status"
    | "planId"
    | "trialEndsAt"
    | "currentPeriodEndsAt"
    | "graceEndsAt"
    | "cancelledAt"
  >
>;

/** What a subscription was, as stored in audit meta (`previous`). */
export type SubscriptionSnapshot = {
  status: SubscriptionStatus;
  planId: string | null;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  graceEndsAt: string | null;
};

export type LifecyclePlan =
  | { ok: true; data: SubscriptionWrite }
  | { ok: false; reason: string };

const STATUSES: ReadonlySet<string> = new Set([
  "TRIAL",
  "ACTIVE",
  "PAST_DUE",
  "CANCELLED",
]);

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function dateOrNull(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

export function snapshotOf(sub: SubscriptionState): SubscriptionSnapshot {
  return {
    status: sub.status,
    planId: sub.planId,
    trialEndsAt: iso(sub.trialEndsAt),
    currentPeriodEndsAt: iso(sub.currentPeriodEndsAt),
    graceEndsAt: iso(sub.graceEndsAt),
  };
}

/**
 * Read a snapshot back from audit meta: `{ previous: {...} }` as written
 * now, or `{ previousStatus }` as older suspensions recorded it.
 */
export function snapshotFromMeta(meta: unknown): SubscriptionSnapshot | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const prev = m.previous;
  if (prev && typeof prev === "object") {
    const p = prev as Record<string, unknown>;
    if (typeof p.status !== "string" || !STATUSES.has(p.status)) return null;
    return {
      status: p.status as SubscriptionStatus,
      planId: typeof p.planId === "string" ? p.planId : null,
      trialEndsAt: typeof p.trialEndsAt === "string" ? p.trialEndsAt : null,
      currentPeriodEndsAt:
        typeof p.currentPeriodEndsAt === "string" ? p.currentPeriodEndsAt : null,
      graceEndsAt: typeof p.graceEndsAt === "string" ? p.graceEndsAt : null,
    };
  }
  if (typeof m.previousStatus === "string" && STATUSES.has(m.previousStatus)) {
    return {
      status: m.previousStatus as SubscriptionStatus,
      planId: null,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      graceEndsAt: null,
    };
  }
  return null;
}

/** «Продлить триал» from the billing page and from the clinics row menu. */
export function planExtendTrial(
  sub: SubscriptionState,
  now: Date,
  opts: { days?: number; expectedTrialEndsAt?: Date | null } = {},
): LifecyclePlan {
  if (
    opts.expectedTrialEndsAt !== undefined &&
    !sameInstant(opts.expectedTrialEndsAt, sub.trialEndsAt)
  ) {
    // Someone (or the first click) already extended it.
    return { ok: false, reason: "subscription_changed" };
  }
  if (sub.status === "ACTIVE") {
    // A paying clinic has no trial to extend; demoting it would start a
    // countdown to PAST_DUE.
    return { ok: false, reason: "subscription_active" };
  }
  const base =
    sub.status === "TRIAL" && sub.trialEndsAt && sub.trialEndsAt > now
      ? sub.trialEndsAt
      : now;
  return {
    ok: true,
    data: {
      status: "TRIAL",
      trialEndsAt: addDays(base, opts.days ?? EXTEND_TRIAL_DAYS),
      graceEndsAt: null,
      cancelledAt: null,
    },
  };
}

/** «Приостановить» / «Отменить подписку». */
export function planCancel(sub: SubscriptionState, now: Date): LifecyclePlan {
  if (sub.status === "CANCELLED") return { ok: false, reason: "already_cancelled" };
  return {
    ok: true,
    data: { status: "CANCELLED", cancelledAt: now, graceEndsAt: null },
  };
}

/**
 * «Восстановить»: only a CANCELLED subscription, back to what it was when
 * it was cancelled (`snapshot`), with dates that already passed handled
 * honestly: a trial or paid period that ran out comes back as PAST_DUE with
 * a fresh grace period, not as a trial nobody granted. Without a snapshot
 * (cancelled some other way) the same PAST_DUE grace applies: access is
 * back and the owner decides the rest.
 */
export function planRestore(
  sub: SubscriptionState,
  snapshot: SubscriptionSnapshot | null,
  now: Date,
): LifecyclePlan {
  if (sub.status !== "CANCELLED") return { ok: false, reason: "not_cancelled" };
  const pastDue: SubscriptionWrite = {
    status: "PAST_DUE",
    graceEndsAt: addDays(now, GRACE_DAYS),
    cancelledAt: null,
  };
  const planId = snapshot?.planId ? { planId: snapshot.planId } : {};
  if (!snapshot) return { ok: true, data: pastDue };

  // Cancelling never clears the trial or period dates, so the row's own
  // dates stand in for a snapshot that has none (older suspensions recorded
  // only the status).
  const trialEndsAt = dateOrNull(snapshot.trialEndsAt) ?? sub.trialEndsAt;
  const periodEndsAt =
    dateOrNull(snapshot.currentPeriodEndsAt) ?? sub.currentPeriodEndsAt;
  const graceEndsAt = dateOrNull(snapshot.graceEndsAt);
  switch (snapshot.status) {
    case "TRIAL":
      if (trialEndsAt && trialEndsAt > now) {
        return {
          ok: true,
          data: { ...planId, status: "TRIAL", trialEndsAt, graceEndsAt: null, cancelledAt: null },
        };
      }
      return { ok: true, data: { ...planId, ...pastDue } };
    case "ACTIVE":
      // An open-ended ACTIVE (no period end) comes back open-ended.
      if (!periodEndsAt || periodEndsAt > now) {
        return {
          ok: true,
          data: { ...planId, status: "ACTIVE", graceEndsAt: null, cancelledAt: null },
        };
      }
      return { ok: true, data: { ...planId, ...pastDue } };
    case "PAST_DUE":
      if (graceEndsAt && graceEndsAt > now) {
        return {
          ok: true,
          data: { ...planId, status: "PAST_DUE", graceEndsAt, cancelledAt: null },
        };
      }
      return { ok: true, data: { ...planId, ...pastDue } };
    case "CANCELLED":
    default:
      return { ok: true, data: { ...planId, ...pastDue } };
  }
}

export type AutoStepReason =
  | "trial_expired"
  | "period_ended"
  | "grace_started"
  | "grace_ended";

export type AutoStep = {
  reason: AutoStepReason;
  to: SubscriptionStatus;
  data: SubscriptionWrite;
};

/**
 * The scheduler's one step for a subscription, or null when nothing is due.
 * A PAST_DUE row with no grace date (made before grace existed, or set by
 * hand) gets one starting now instead of being cancelled on the spot.
 */
export function nextAutoStep(sub: SubscriptionState, now: Date): AutoStep | null {
  const t = now.getTime();
  switch (sub.status) {
    case "TRIAL":
      if (sub.trialEndsAt && sub.trialEndsAt.getTime() < t) {
        return {
          reason: "trial_expired",
          to: "PAST_DUE",
          data: { status: "PAST_DUE", graceEndsAt: addDays(now, GRACE_DAYS) },
        };
      }
      return null;
    case "ACTIVE":
      if (sub.currentPeriodEndsAt && sub.currentPeriodEndsAt.getTime() < t) {
        return {
          reason: "period_ended",
          to: "PAST_DUE",
          data: { status: "PAST_DUE", graceEndsAt: addDays(now, GRACE_DAYS) },
        };
      }
      return null;
    case "PAST_DUE":
      if (!sub.graceEndsAt) {
        return {
          reason: "grace_started",
          to: "PAST_DUE",
          data: { graceEndsAt: addDays(now, GRACE_DAYS) },
        };
      }
      if (sub.graceEndsAt.getTime() < t) {
        return {
          reason: "grace_ended",
          to: "CANCELLED",
          data: { status: "CANCELLED", cancelledAt: now },
        };
      }
      return null;
    case "CANCELLED":
    default:
      return null;
  }
}

/**
 * Status-side defaults for the admin's raw PATCH (status override): entering
 * PAST_DUE starts a grace period unless one is given, leaving it clears the
 * grace date, leaving CANCELLED clears the cancellation date.
 */
export function statusOverrideExtras(
  before: SubscriptionState,
  nextStatus: SubscriptionStatus,
  now: Date,
): SubscriptionWrite {
  if (nextStatus === before.status) return {};
  const extras: SubscriptionWrite = {};
  if (nextStatus === "PAST_DUE") {
    extras.graceEndsAt = addDays(now, GRACE_DAYS);
  } else {
    extras.graceEndsAt = null;
  }
  if (nextStatus === "CANCELLED") extras.cancelledAt = now;
  else if (before.status === "CANCELLED") extras.cancelledAt = null;
  return extras;
}

export function trialEndFor(now: Date, days: number): Date {
  return addDays(now, days);
}

type SubscriptionCreateDb = {
  subscription: {
    create: (args: {
      data: {
        clinicId: string;
        planId: string;
        status: "TRIAL";
        trialEndsAt: Date;
      };
    }) => Promise<{ id: string }>;
  };
};

/**
 * The one way a subscription comes into being: with its clinic (platform
 * console, self-signup) or by the platform owner's explicit «Создать
 * подписку» for a clinic that predates this. A TRIAL on the chosen plan.
 */
export async function createSubscription(
  db: SubscriptionCreateDb,
  input: { clinicId: string; planId: string; trialDays: number; now?: Date },
): Promise<{ id: string; trialEndsAt: Date }> {
  const trialEndsAt = trialEndFor(input.now ?? new Date(), input.trialDays);
  const row = await db.subscription.create({
    data: {
      clinicId: input.clinicId,
      planId: input.planId,
      status: "TRIAL",
      trialEndsAt,
    },
  });
  return { id: row.id, trialEndsAt };
}
