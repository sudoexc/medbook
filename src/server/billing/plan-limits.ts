/**
 * Phase 19 Wave 1 — plan-limit enforcement.
 *
 * Two layers:
 *
 *   1. `evaluateLimit(current, max, isFreePlan)` — pure, sync, branchy. The
 *      table-test sweet spot. `max=-1` is the "unlimited" sentinel and short-
 *      circuits to `ok`. Below 80% → ok. 80–99% → warn. 100%+ → block on the
 *      Free plan, warn on Pro/Enterprise (warn-only — paying tenants are
 *      never blocked mid-flight; we surface the breach in the billing UI).
 *
 *   2. `ensurePatientLimit` / `ensureAppointmentLimit` / `ensureSmsLimit` —
 *      composers that fetch usage + flags + plan slug, run `evaluateLimit`,
 *      and emit the appropriate audit row when the result is `warn` or
 *      `block`. Auditing fires on every API entry that gets `ok: false` —
 *      we accept the noise; the alternative requires per-clinic state we
 *      don't have yet.
 *
 *   3. `ensureQuotaForApi(clinicId, quota)` — convenience wrapper that
 *      maps a `block` outcome onto a 402-style JSON Response. API handlers
 *      call this at the top of a mutating route and bail early on a non-null
 *      return value, mirroring the `ensureFeature` pattern from
 *      `src/server/platform/feature-guard.ts`.
 *
 * `isFreePlan` is the slug-equality check `subscription.plan.slug === "basic"`.
 * Hard-block applies only to that tier. The roadmap copy talks about
 * "Free / Starter / Pro" but the seed slugs are the source of truth.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  DEFAULT_FLAGS,
  parsePlanFeatures,
  type FeatureFlags,
} from "@/lib/feature-flags";
import { getClinicUsage } from "@/server/billing/usage";

/** Numeric quota keys we evaluate. */
export type NumericQuota =
  | "maxPatients"
  | "maxAppointmentsPerMonth"
  | "maxSmsPerMonth"
  | "maxStorageMb";

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
 * Internal — fetch plan slug + features for one clinic without re-running
 * the tenant-scope extension. Mirrors `getFeatureFlags` but also returns
 * the slug so the composer can decide isFreePlan.
 */
async function loadPlanContext(clinicId: string): Promise<{
  flags: FeatureFlags;
  isFreePlan: boolean;
}> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const sub = await prisma.subscription.findUnique({
      where: { clinicId },
      include: { plan: true },
    });

    if (!sub) {
      // No subscription → treat as Basic (free). Hard-block applies.
      return { flags: { ...DEFAULT_FLAGS }, isFreePlan: true };
    }

    const slug = sub.plan.slug;
    const isFreePlan = slug === "basic";

    switch (sub.status) {
      case "TRIAL":
      case "ACTIVE":
      case "PAST_DUE":
        return { flags: parsePlanFeatures(sub.plan.features), isFreePlan };
      case "CANCELLED":
      default:
        // Cancelled subscription falls back to default (basic) flags but
        // the slug is still the cancelled plan — for hard-block purposes we
        // treat them as Free regardless, since they no longer pay.
        return { flags: { ...DEFAULT_FLAGS }, isFreePlan: true };
    }
  });
}

/**
 * Internal — write a PLAN_LIMIT_WARNED / _BLOCKED audit row. We intentionally
 * audit every `ok: false` outcome rather than storing per-clinic threshold
 * state; the volume is acceptable for Wave 1 and the audit table already
 * supports indexed `(action, createdAt)` slicing.
 */
async function auditLimit(
  clinicId: string,
  result: Extract<LimitCheckResult, { ok: false }>,
): Promise<void> {
  const action =
    result.kind === "warn"
      ? AUDIT_ACTION.PLAN_LIMIT_WARNED
      : AUDIT_ACTION.PLAN_LIMIT_BLOCKED;
  try {
    await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.auditLog.create({
        data: {
          clinicId,
          action,
          entityType: "Clinic",
          entityId: clinicId,
          meta: {
            quota: result.quota,
            current: result.current,
            max: result.max,
            pctUsed: result.pctUsed,
          },
        },
      }),
    );
  } catch (err) {
    // Audit failures must never break the mainline. Log and continue.
    console.warn(
      `[plan-limits] audit failed clinic=${clinicId} kind=${result.kind} quota=${result.quota}`,
      err,
    );
  }
}

async function ensureNumericQuota(
  clinicId: string,
  quota: NumericQuota,
  pickCurrent: (snap: Awaited<ReturnType<typeof getClinicUsage>>) => number,
): Promise<LimitCheckResult> {
  const [usage, planCtx] = await Promise.all([
    getClinicUsage(clinicId),
    loadPlanContext(clinicId),
  ]);
  const max = planCtx.flags[quota];
  const current = pickCurrent(usage);
  const result = evaluateLimit(current, max, planCtx.isFreePlan, quota);
  if (!result.ok) await auditLimit(clinicId, result);
  return result;
}

export async function ensurePatientLimit(
  clinicId: string,
): Promise<LimitCheckResult> {
  return ensureNumericQuota(clinicId, "maxPatients", (s) => s.patientCount);
}

export async function ensureAppointmentLimit(
  clinicId: string,
): Promise<LimitCheckResult> {
  return ensureNumericQuota(
    clinicId,
    "maxAppointmentsPerMonth",
    (s) => s.appointmentCountThisMonth,
  );
}

export async function ensureSmsLimit(
  clinicId: string,
): Promise<LimitCheckResult> {
  return ensureNumericQuota(
    clinicId,
    "maxSmsPerMonth",
    (s) => s.smsCountThisMonth,
  );
}

const QUOTA_DISPATCH: Record<
  "maxPatients" | "maxAppointmentsPerMonth" | "maxSmsPerMonth",
  (clinicId: string) => Promise<LimitCheckResult>
> = {
  maxPatients: ensurePatientLimit,
  maxAppointmentsPerMonth: ensureAppointmentLimit,
  maxSmsPerMonth: ensureSmsLimit,
};

/**
 * API guard. Returns a 402 `Response` (Payment Required) with a JSON body
 * when the named quota is exhausted on a Free plan. Returns `null` otherwise
 * — including `warn` results, which are surfaced to the UI separately and
 * must NOT block API calls.
 *
 * Designed to be the very first thing inside a mutating route handler:
 *
 *   const block = await ensureQuotaForApi(clinicId, "maxPatients");
 *   if (block) return block;
 */
export async function ensureQuotaForApi(
  clinicId: string,
  quota: "maxPatients" | "maxAppointmentsPerMonth" | "maxSmsPerMonth",
): Promise<Response | null> {
  const checker = QUOTA_DISPATCH[quota];
  const result = await checker(clinicId);
  if (result.ok) return null;
  if (result.kind === "warn") return null;
  return Response.json(
    {
      error: "PlanLimitExceeded",
      quota,
      max: result.max,
      current: result.current,
    },
    { status: 402 },
  );
}
