/**
 * Phase 19 Wave 1 — plan-limit enforcement.
 *
 * Two layers:
 *
 *   1. `evaluateLimit(current, max, isFreePlan)` — pure, sync, branchy (it
 *      lives in quota-rule.ts with `planContextOf` and `guardCounts`, and is
 *      re-exported here). The table-test sweet spot. `max=-1` is the "unlimited" sentinel and short-
 *      circuits to `ok`. Below 80% → ok. 80–99% → warn. 100%+ → block on the
 *      Free plan, warn on Pro/Enterprise (warn-only — paying tenants are
 *      never blocked mid-flight; we surface the breach in the billing UI).
 *
 *   2. `ensurePatientLimit` / `ensureAppointmentLimit` — composers that
 *      fetch usage + flags + plan slug, run `evaluateLimit`, and emit the
 *      appropriate audit row when the result is `warn` or `block`. Auditing
 *      fires on every API entry that gets `ok: false` — we accept the
 *      noise; the alternative requires per-clinic state we don't have yet.
 *      `ensureSmsLimit` was removed in Wave 3 of `docs/TZ-sms-removal.md`.
 *
 *   3. `ensureQuotaForApi(clinicId, quota)` — the API guard: a 402 JSON
 *      Response when the quota is exhausted on a plan that blocks, null
 *      otherwise. Called right before the row is created by the CRM's
 *      patient create, booking and walk-in routes (audit SEC-10: nothing
 *      called any of these, so the Basic plan's 50 patients never stopped
 *      anyone). Plans that only warn are not counted at all here, so a
 *      paying clinic pays one subscription read per create and never gets a
 *      warning audit row per patient; a failure of the check itself lets the
 *      create through (fail open: a limit check must never stop the desk
 *      because the database hiccuped).
 *
 * `isFreePlan` is the slug-equality check `subscription.plan.slug === "basic"`.
 * Hard-block applies only to that tier. The roadmap copy talks about
 * "Free / Starter / Pro" but the seed slugs are the source of truth.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { getClinicUsage } from "@/server/billing/usage";
import {
  evaluateLimit,
  guardCounts,
  planContextOf,
  quotaCountQuery,
  type GuardQuota,
  type LimitCheckResult,
  type PlanContext,
} from "@/server/billing/quota-rule";

// The pure rule moved to quota-rule.ts (shared with the pre-deploy dry
// run); re-exported so existing callers keep importing it from here.
export { evaluateLimit, type LimitCheckResult };

/** Numeric quota keys we evaluate. */
export type NumericQuota =
  | "maxPatients"
  | "maxAppointmentsPerMonth"
  | "maxStorageMb";

/**
 * Internal — fetch plan slug + features for one clinic without re-running
 * the tenant-scope extension. Mirrors `getFeatureFlags` but also returns
 * the slug so the composer can decide isFreePlan.
 */
async function loadPlanContext(clinicId: string): Promise<PlanContext> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const sub = await prisma.subscription.findUnique({
      where: { clinicId },
      include: { plan: true },
    });
    // No subscription, or a cancelled one, means Basic limits that block
    // (`planContextOf`).
    return planContextOf(sub);
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

// `ensureSmsLimit` was deleted in Wave 3 of `docs/TZ-sms-removal.md`
// together with `maxSmsPerMonth` and `smsCountThisMonth`.

/** Current usage of one quota, counted alone (the guard needs one number). */
async function countFor(
  clinicId: string,
  quota: GuardQuota,
  now: Date,
): Promise<number> {
  const q = quotaCountQuery(clinicId, quota, now);
  return runWithTenant({ kind: "SYSTEM" }, () =>
    q.model === "patient"
      ? prisma.patient.count({ where: q.where })
      : prisma.appointment.count({ where: q.where }),
  );
}

/**
 * API guard. Returns a 402 `Response` (Payment Required) with a JSON body
 * when the named quota is exhausted on a plan that blocks (Basic, or any
 * cancelled subscription). Returns `null` otherwise, warnings included:
 * they are shown on the billing page and must NOT block API calls.
 *
 * Call it right before the create, after validation and dedupe, so a
 * request that would not have created anything is not refused:
 *
 *   const block = await ensureQuotaForApi(clinicId, "maxPatients");
 *   if (block) return block;
 */
export async function ensureQuotaForApi(
  clinicId: string,
  quota: GuardQuota,
  now: Date = new Date(),
): Promise<Response | null> {
  try {
    const planCtx = await loadPlanContext(clinicId);
    // Warn-only plans (and unlimited quotas) never block: skip the counting
    // entirely.
    if (!guardCounts(planCtx, quota)) return null;
    const max = planCtx.flags[quota];
    const current = await countFor(clinicId, quota, now);
    const result = evaluateLimit(current, max, true, quota);
    if (result.ok || result.kind === "warn") return null;
    await auditLimit(clinicId, result);
    return Response.json(
      {
        error: "PlanLimitExceeded",
        reason: "plan_limit",
        quota,
        max: result.max,
        current: result.current,
      },
      { status: 402 },
    );
  } catch (e) {
    console.error(`[plan-limits] check failed clinic=${clinicId} quota=${quota}`, e);
    return null;
  }
}
