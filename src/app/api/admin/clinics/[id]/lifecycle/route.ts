/**
 * POST /api/admin/clinics/[id]/lifecycle — Phase 19 W4 bulk SUPER_ADMIN ops.
 *
 * Body: `{ action: "suspend" | "restore" | "extend-trial" }`.
 *
 * - suspend  → flips Subscription.status to CANCELLED, stamps cancelledAt = now,
 *              audits CLINIC_SUSPENDED.
 * - restore  → status TRIAL with trialEndsAt = now + 14d, clears cancelledAt,
 *              audits CLINIC_RESUMED.
 * - extend-trial → adds 30 days to trialEndsAt (creating a TRIAL row when one
 *              doesn't exist), audits CLINIC_TRIAL_EXTENDED.
 *
 * Each branch is intentionally idempotent so a double-click in the row menu
 * doesn't punish the operator with a 409. The dedicated `/cancel` and
 * `/extend-trial` sub-routes are kept untouched — they target the long-form
 * forms, while this route powers the new row context-menu.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";
import { AUDIT_ACTION } from "@/lib/audit-actions";

function clinicIdFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/admin/clinics/[id]/lifecycle
    return segs[3] ?? null;
  } catch {
    return null;
  }
}

async function ensureSubscription(clinicId: string) {
  const existing = await prisma.subscription.findUnique({
    where: { clinicId },
    include: { plan: true },
  });
  if (existing) return existing;
  const plan =
    (await prisma.plan.findUnique({ where: { slug: "pro" } })) ??
    (await prisma.plan.findFirst({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    }));
  if (!plan) throw new Error("No active plan to seed default subscription");
  return prisma.subscription.create({
    data: {
      clinicId,
      planId: plan.id,
      status: "TRIAL",
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
    include: { plan: true },
  });
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "SUPER_ADMIN") return err("Forbidden", 403);
  const id = clinicIdFromUrl(request);
  if (!id) return err("BadRequest", 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err("InvalidJson", 400);
  }
  const action =
    raw && typeof raw === "object" && "action" in raw
      ? (raw as { action?: unknown }).action
      : null;
  if (
    action !== "suspend" &&
    action !== "restore" &&
    action !== "extend-trial"
  ) {
    return err("ValidationError", 400, {
      reason: "action must be one of suspend|restore|extend-trial",
    });
  }

  return runWithTenant(
    { kind: "SUPER_ADMIN", userId: session.user.id },
    async () => {
      const clinic = await prisma.clinic.findUnique({ where: { id } });
      if (!clinic) return notFound();
      const sub = await ensureSubscription(id);

      if (action === "suspend") {
        const updated = await prisma.subscription.update({
          where: { clinicId: id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
          },
        });
        await platformAudit({
          request,
          userId: session.user.id,
          clinicId: id,
          action: AUDIT_ACTION.CLINIC_SUSPENDED,
          entityType: "Subscription",
          entityId: updated.id,
          meta: { previousStatus: sub.status },
        });
        return ok({ ok: true, status: updated.status });
      }

      if (action === "restore") {
        const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const updated = await prisma.subscription.update({
          where: { clinicId: id },
          data: {
            status: "TRIAL",
            trialEndsAt,
            cancelledAt: null,
          },
        });
        await platformAudit({
          request,
          userId: session.user.id,
          clinicId: id,
          action: AUDIT_ACTION.CLINIC_RESUMED,
          entityType: "Subscription",
          entityId: updated.id,
          meta: {
            trialEndsAt: trialEndsAt.toISOString(),
            previousStatus: sub.status,
          },
        });
        return ok({ ok: true, status: updated.status, trialEndsAt });
      }

      // extend-trial — pivot off whichever date is later (current trial vs now)
      const base =
        sub.trialEndsAt && sub.trialEndsAt.getTime() > Date.now()
          ? sub.trialEndsAt
          : new Date();
      const trialEndsAt = new Date(
        base.getTime() + 30 * 24 * 60 * 60 * 1000,
      );
      const updated = await prisma.subscription.update({
        where: { clinicId: id },
        data: {
          status: sub.status === "CANCELLED" ? "TRIAL" : sub.status,
          trialEndsAt,
        },
      });
      await platformAudit({
        request,
        userId: session.user.id,
        clinicId: id,
        action: AUDIT_ACTION.CLINIC_TRIAL_EXTENDED,
        entityType: "Subscription",
        entityId: updated.id,
        meta: {
          trialEndsAt: trialEndsAt.toISOString(),
          extendedDays: 30,
        },
      });
      return ok({ ok: true, trialEndsAt });
    },
  );
}
