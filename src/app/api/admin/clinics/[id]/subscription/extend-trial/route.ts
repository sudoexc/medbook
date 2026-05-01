/**
 * POST /api/admin/clinics/[id]/subscription/extend-trial
 *
 * SUPER_ADMIN convenience: bumps the linked subscription's `trialEndsAt` by
 * 30 days. If `trialEndsAt` is null (e.g. the clinic was promoted to ACTIVE
 * then reverted), the new value is `now + 30d`. Defensively auto-creates the
 * subscription using the same fallback as the GET handler if it's missing.
 *
 * The handler does NOT change `status` — extending a trial after expiry is a
 * separate decision; the admin can flip TRIAL→PAST_DUE etc. via the PATCH
 * endpoint if needed.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function clinicIdFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/admin/clinics/[id]/subscription/extend-trial
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
      trialEndsAt: new Date(Date.now() + THIRTY_DAYS_MS),
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

    const before = await prisma.subscription.findUnique({
      where: { clinicId: id },
      select: { id: true, trialEndsAt: true },
    });
    if (!before) {
      // Should be unreachable after ensureSubscriptionId but keeps TS happy.
      return err("InternalError", 500);
    }

    const base =
      before.trialEndsAt && before.trialEndsAt.getTime() > Date.now()
        ? before.trialEndsAt
        : new Date();
    const next = new Date(base.getTime() + THIRTY_DAYS_MS);

    const updated = await prisma.subscription.update({
      where: { clinicId: id },
      data: { trialEndsAt: next },
      include: { plan: true },
    });

    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: id,
      action: "subscription.extend_trial",
      entityType: "Subscription",
      entityId: updated.id,
      meta: {
        from: before.trialEndsAt?.toISOString() ?? null,
        to: next.toISOString(),
      },
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
