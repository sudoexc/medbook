/**
 * Phase 9c — Admin subscription endpoints (SUPER_ADMIN only).
 *
 *   GET   /api/admin/clinics/[id]/subscription
 *     Returns `{ clinic, subscription }`; `subscription` is null for a clinic
 *     that has none. Reading writes nothing (audit G5-03): it used to create
 *     a 30-day Pro trial the first time anyone opened the page.
 *
 *   POST  /api/admin/clinics/[id]/subscription
 *     The explicit «Создать подписку» for a clinic without one: a TRIAL on
 *     the chosen plan for the chosen number of days (`createSubscription`).
 *     409 when one exists.
 *
 *   PATCH /api/admin/clinics/[id]/subscription
 *     Updates plan / status / trialEndsAt / currentPeriodEndsAt / cancelledAt.
 *     Body validated by `PatchSubscriptionSchema`. 409 `NoSubscription` when
 *     there is none. A status override keeps the lifecycle dates consistent
 *     (`planStatusOverride`): entering PAST_DUE starts a grace period,
 *     leaving it clears the grace date, and a TRIAL whose trial already
 *     ended is refused (409 `trial_ended`) while an ACTIVE over an ended
 *     paid period becomes open-ended, so the scheduler does not undo the
 *     override a minute later.
 *
 * `clinicId` is read from the URL path (positional segment 4 — `/api/admin/
 * clinics/[id]/subscription`). The companion sub-paths `/extend-trial` and
 * `/cancel` live in their own files for handler clarity.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound } from "@/server/http";
import { platformAudit, requireSuperAdmin } from "@/server/platform/handler";
import {
  CreateSubscriptionSchema,
  PatchSubscriptionSchema,
} from "@/server/schemas/platform";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  createSubscription,
  planStatusOverride,
  snapshotOf,
} from "@/server/platform/subscription-lifecycle";
import {
  loadSubscription,
  serializeSubscription,
  stateOf,
} from "@/server/platform/subscription-admin";

function clinicIdFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/admin/clinics/[id]/subscription
    //  0   1     2       3    4
    return segs[3] ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) return notFound();

    const sub = await loadSubscription(id);
    return ok({
      clinic: {
        id: clinic.id,
        slug: clinic.slug,
        nameRu: clinic.nameRu,
        nameUz: clinic.nameUz,
      },
      subscription: sub ? serializeSubscription(sub) : null,
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return err("InvalidJson", 400);
    }
    const parsed = CreateSubscriptionSchema.safeParse(raw);
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }
    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) return notFound();
    if (await loadSubscription(id)) {
      return err("Conflict", 409, { reason: "subscription_exists" });
    }
    const plan = await prisma.plan.findUnique({
      where: { id: parsed.data.planId },
      select: { id: true, isActive: true },
    });
    if (!plan || !plan.isActive) {
      return err("ValidationError", 400, { reason: "invalid_plan" });
    }
    const created = await createSubscription(prisma, {
      clinicId: id,
      planId: plan.id,
      trialDays: parsed.data.trialDays,
    });
    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: id,
      action: AUDIT_ACTION.SUBSCRIPTION_CREATED,
      entityType: "Subscription",
      entityId: created.id,
      meta: {
        planId: plan.id,
        trialEndsAt: created.trialEndsAt.toISOString(),
        source: "admin",
      },
    });
    const sub = await loadSubscription(id);
    return ok({ subscription: sub ? serializeSubscription(sub) : null }, 201);
  });
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return err("InvalidJson", 400);
    }
    const parsed = PatchSubscriptionSchema.safeParse(raw);
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }

    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) return notFound();

    // If `planId` is supplied, verify it points at an active Plan.
    if (parsed.data.planId !== undefined) {
      const plan = await prisma.plan.findUnique({
        where: { id: parsed.data.planId },
        select: { id: true, isActive: true },
      });
      if (!plan || !plan.isActive) {
        return err("ValidationError", 400, { reason: "invalid_plan" });
      }
    }

    const existing = await loadSubscription(id);
    if (!existing) return err("NoSubscription", 409, { reason: "no_subscription" });

    const before = stateOf(existing);
    const override = planStatusOverride(
      before,
      {
        status: parsed.data.status,
        trialEndsAt: parsed.data.trialEndsAt,
        currentPeriodEndsAt: parsed.data.currentPeriodEndsAt,
      },
      new Date(),
    );
    if (!override.ok) {
      return err("Conflict", 409, {
        reason: override.reason,
        subscription: serializeSubscription(existing),
      });
    }
    const extras = override.data;

    const updated = await prisma.subscription.update({
      where: { clinicId: id },
      data: {
        ...extras,
        ...(parsed.data.planId !== undefined ? { planId: parsed.data.planId } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.trialEndsAt !== undefined
          ? { trialEndsAt: parsed.data.trialEndsAt ?? null }
          : {}),
        ...(parsed.data.currentPeriodEndsAt !== undefined
          ? { currentPeriodEndsAt: parsed.data.currentPeriodEndsAt ?? null }
          : {}),
        ...(parsed.data.cancelledAt !== undefined
          ? { cancelledAt: parsed.data.cancelledAt ?? null }
          : {}),
      },
      include: { plan: true },
    });

    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: id,
      action: "subscription.update",
      entityType: "Subscription",
      entityId: updated.id,
      // `previous`: what the override replaced, a cleared paid-period end
      // included.
      meta: { changed: Object.keys(parsed.data), previous: snapshotOf(before) },
    });

    return ok({ subscription: serializeSubscription(updated) });
  });
}
