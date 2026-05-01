/**
 * POST /api/admin/clinics/[id]/subscription/cancel
 *
 * Soft-cancellation: sets `status=CANCELLED` and `cancelledAt=NOW()`. Does not
 * delete the row — the audit trail and the option to revert (PATCH back to
 * ACTIVE / TRIAL) both depend on the row staying around.
 *
 * Defensively auto-creates the subscription if missing, then immediately
 * marks it cancelled — so the operation is meaningful even if a clinic somehow
 * never received its 9b backfill.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";

function clinicIdFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/admin/clinics/[id]/subscription/cancel
    //  0   1     2       3    4            5
    return segs[3] ?? null;
  } catch {
    return null;
  }
}

async function requireSuper(): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: err("Unauthorized", 401) };
  if (session.user.role !== "SUPER_ADMIN") {
    return { ok: false, response: err("Forbidden", 403) };
  }
  return { ok: true, userId: session.user.id };
}

async function ensureSubscriptionId(clinicId: string): Promise<string> {
  const existing = await prisma.subscription.findUnique({
    where: { clinicId },
    select: { id: true },
  });
  if (existing) return existing.id;
  const fallbackPlan =
    (await prisma.plan.findUnique({ where: { slug: "pro" } })) ??
    (await prisma.plan.findFirst({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    }));
  if (!fallbackPlan) {
    throw new Error(
      "No active Plan rows found — run `npx prisma migrate dev` to seed the catalog.",
    );
  }
  const created = await prisma.subscription.create({
    data: {
      clinicId,
      planId: fallbackPlan.id,
      status: "TRIAL",
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  return created.id;
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) return notFound();

    await ensureSubscriptionId(id);

    const cancelledAt = new Date();
    const updated = await prisma.subscription.update({
      where: { clinicId: id },
      data: { status: "CANCELLED", cancelledAt },
      include: { plan: true },
    });

    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: id,
      action: "subscription.cancel",
      entityType: "Subscription",
      entityId: updated.id,
      meta: { cancelledAt: cancelledAt.toISOString() },
    });

    return ok({
      subscription: {
        id: updated.id,
        clinicId: updated.clinicId,
        planId: updated.planId,
        status: updated.status,
        trialEndsAt: updated.trialEndsAt,
        currentPeriodEndsAt: updated.currentPeriodEndsAt,
        cancelledAt: updated.cancelledAt,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        plan: updated.plan,
      },
    });
  });
}
