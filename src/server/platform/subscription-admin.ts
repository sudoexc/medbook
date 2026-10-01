/**
 * The SUPER_ADMIN subscription actions behind /api/admin/clinics/[id]/…
 * (audit G5-01, G5-03). The billing page's buttons and the clinics row menu
 * call the same functions here, so «Продлить триал» and «Пробный +30 дней»
 * cannot drift apart again, and both cancel paths record the same audit
 * action with the snapshot «Восстановить» needs.
 *
 * Callers are already inside `runWithTenant({ kind: "SUPER_ADMIN" })` and
 * have passed `requireSuperAdmin`. A clinic without a subscription gets 409
 * `NoSubscription`: subscriptions are created explicitly
 * (`createSubscription`), never as a side effect of looking or clicking.
 */
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";
import {
  EXTEND_TRIAL_DAYS,
  planCancel,
  planExtendTrial,
  planRestore,
  snapshotFromMeta,
  snapshotOf,
  type SubscriptionSnapshot,
  type SubscriptionState,
  type SubscriptionWrite,
} from "@/server/platform/subscription-lifecycle";

type SubscriptionWithPlan = NonNullable<
  Awaited<ReturnType<typeof loadSubscription>>
>;

export async function loadSubscription(clinicId: string) {
  return prisma.subscription.findUnique({
    where: { clinicId },
    include: { plan: true },
  });
}

export function stateOf(sub: {
  status: SubscriptionState["status"];
  planId: string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  graceEndsAt?: Date | null;
  cancelledAt: Date | null;
}): SubscriptionState {
  return {
    status: sub.status,
    planId: sub.planId,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEndsAt: sub.currentPeriodEndsAt,
    graceEndsAt: sub.graceEndsAt ?? null,
    cancelledAt: sub.cancelledAt,
  };
}

/** The response shape every admin subscription route returns. */
export function serializeSubscription(sub: SubscriptionWithPlan) {
  return {
    id: sub.id,
    clinicId: sub.clinicId,
    planId: sub.planId,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEndsAt: sub.currentPeriodEndsAt,
    graceEndsAt: sub.graceEndsAt ?? null,
    cancelledAt: sub.cancelledAt,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    plan: sub.plan,
  };
}

async function writeSubscription(clinicId: string, data: SubscriptionWrite) {
  return prisma.subscription.update({
    where: { clinicId },
    data,
    include: { plan: true },
  });
}

/**
 * How long a cancelled subscription's suspension record may lie from its
 * `cancelledAt`: the audit row is written right after the update.
 */
const SUSPENSION_MATCH_MS = 5 * 60 * 1000;

/**
 * What the subscription was before the cancellation that is in force now:
 * the latest CLINIC_SUSPENDED or automatic cancel, if it is the one that
 * set `cancelledAt` (a cancel through the raw status override leaves no
 * snapshot, and an older suspension must not be replayed).
 */
export async function suspensionSnapshot(
  clinicId: string,
  cancelledAt: Date | null,
): Promise<SubscriptionSnapshot | null> {
  const rows = await prisma.auditLog.findMany({
    where: {
      clinicId,
      entityType: "Subscription",
      action: {
        in: [
          AUDIT_ACTION.CLINIC_SUSPENDED,
          AUDIT_ACTION.SUBSCRIPTION_AUTO_TRANSITION,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { action: true, meta: true, createdAt: true },
  });
  for (const row of rows) {
    const meta = row.meta as Record<string, unknown> | null;
    const isCancel =
      row.action === AUDIT_ACTION.CLINIC_SUSPENDED || meta?.to === "CANCELLED";
    if (!isCancel) continue;
    if (
      cancelledAt &&
      Math.abs(row.createdAt.getTime() - cancelledAt.getTime()) > SUSPENSION_MATCH_MS
    ) {
      return null;
    }
    return snapshotFromMeta(meta);
  }
  return null;
}

export async function extendTrialResponse(input: {
  request: Request;
  userId: string;
  clinicId: string;
  expectedTrialEndsAt?: Date | null;
  now?: Date;
}): Promise<Response> {
  const now = input.now ?? new Date();
  const clinic = await prisma.clinic.findUnique({
    where: { id: input.clinicId },
    select: { id: true },
  });
  if (!clinic) return notFound();
  const sub = await loadSubscription(input.clinicId);
  if (!sub) return err("NoSubscription", 409, { reason: "no_subscription" });

  const before = stateOf(sub);
  const plan = planExtendTrial(before, now, {
    days: EXTEND_TRIAL_DAYS,
    expectedTrialEndsAt: input.expectedTrialEndsAt,
  });
  if (!plan.ok) {
    return err("Conflict", 409, {
      reason: plan.reason,
      subscription: serializeSubscription(sub),
    });
  }
  const updated = await writeSubscription(input.clinicId, plan.data);
  await platformAudit({
    request: input.request,
    userId: input.userId,
    clinicId: input.clinicId,
    action: AUDIT_ACTION.CLINIC_TRIAL_EXTENDED,
    entityType: "Subscription",
    entityId: updated.id,
    meta: {
      previousStatus: before.status,
      status: updated.status,
      from: before.trialEndsAt?.toISOString() ?? null,
      to: updated.trialEndsAt?.toISOString() ?? null,
      extendedDays: EXTEND_TRIAL_DAYS,
    },
  });
  return ok({ subscription: serializeSubscription(updated) });
}

export async function cancelResponse(input: {
  request: Request;
  userId: string;
  clinicId: string;
  now?: Date;
}): Promise<Response> {
  const now = input.now ?? new Date();
  const clinic = await prisma.clinic.findUnique({
    where: { id: input.clinicId },
    select: { id: true },
  });
  if (!clinic) return notFound();
  const sub = await loadSubscription(input.clinicId);
  if (!sub) return err("NoSubscription", 409, { reason: "no_subscription" });

  const before = stateOf(sub);
  const plan = planCancel(before, now);
  if (!plan.ok) {
    // Already cancelled: a double click is not an error.
    return ok({ subscription: serializeSubscription(sub) });
  }
  const updated = await writeSubscription(input.clinicId, plan.data);
  await platformAudit({
    request: input.request,
    userId: input.userId,
    clinicId: input.clinicId,
    action: AUDIT_ACTION.CLINIC_SUSPENDED,
    entityType: "Subscription",
    entityId: updated.id,
    meta: {
      previous: snapshotOf(before),
      previousStatus: before.status,
      to: "CANCELLED",
      cancelledAt: now.toISOString(),
    },
  });
  return ok({ subscription: serializeSubscription(updated) });
}

export async function restoreResponse(input: {
  request: Request;
  userId: string;
  clinicId: string;
  now?: Date;
}): Promise<Response> {
  const now = input.now ?? new Date();
  const clinic = await prisma.clinic.findUnique({
    where: { id: input.clinicId },
    select: { id: true },
  });
  if (!clinic) return notFound();
  const sub = await loadSubscription(input.clinicId);
  if (!sub) return err("NoSubscription", 409, { reason: "no_subscription" });

  const before = stateOf(sub);
  const snapshot =
    before.status === "CANCELLED"
      ? await suspensionSnapshot(input.clinicId, before.cancelledAt)
      : null;
  const plan = planRestore(before, snapshot, now);
  if (!plan.ok) {
    return err("Conflict", 409, {
      reason: plan.reason,
      subscription: serializeSubscription(sub),
    });
  }
  const data = { ...plan.data };
  if (data.planId && data.planId !== before.planId) {
    // The plan it was on may have been retired since.
    const plan2 = await prisma.plan.findUnique({
      where: { id: data.planId },
      select: { id: true, isActive: true },
    });
    if (!plan2?.isActive) delete data.planId;
  }
  const updated = await writeSubscription(input.clinicId, data);
  await platformAudit({
    request: input.request,
    userId: input.userId,
    clinicId: input.clinicId,
    action: AUDIT_ACTION.CLINIC_RESUMED,
    entityType: "Subscription",
    entityId: updated.id,
    meta: {
      previousStatus: before.status,
      restoredFrom: snapshot,
      status: updated.status,
      trialEndsAt: updated.trialEndsAt?.toISOString() ?? null,
      graceEndsAt: updated.graceEndsAt?.toISOString() ?? null,
    },
  });
  return ok({ subscription: serializeSubscription(updated) });
}
