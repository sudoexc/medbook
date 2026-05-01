/**
 * Phase 9c — Admin subscription endpoints (SUPER_ADMIN only).
 *
 *   GET   /api/admin/clinics/[id]/subscription
 *     Returns `{ subscription, plan }` for the given clinic. If no Subscription
 *     row exists (shouldn't happen post-9b backfill, but defended), the route
 *     auto-creates a TRIAL on the canonical `pro` plan with a 30-day trial so
 *     the billing UI never sees an empty state. The auto-create is also the
 *     defensive path for clinics created via Stripe webhooks before the admin
 *     opens the page.
 *
 *   PATCH /api/admin/clinics/[id]/subscription
 *     Updates plan / status / trialEndsAt / currentPeriodEndsAt / cancelledAt.
 *     Body validated by `PatchSubscriptionSchema`. Auto-creates the same
 *     default TRIAL row if missing, then applies the patch on top.
 *
 * `clinicId` is read from the URL path (positional segment 4 — `/api/admin/
 * clinics/[id]/subscription`). The companion sub-paths `/extend-trial` and
 * `/cancel` live in their own files for handler clarity.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";
import { PatchSubscriptionSchema } from "@/server/schemas/platform";

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

/**
 * Find or create the canonical "default" subscription for a clinic.
 *
 * Falls back to a TRIAL on `pro` for 30 days. If no Plan rows exist at all
 * (i.e. the migration's seeded plans got wiped) we throw — that's a platform
 * misconfiguration, not a per-clinic concern.
 */
async function ensureSubscription(clinicId: string) {
  const existing = await prisma.subscription.findUnique({
    where: { clinicId },
    include: { plan: true },
  });
  if (existing) return existing;

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
  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const created = await prisma.subscription.create({
    data: {
      clinicId,
      planId: fallbackPlan.id,
      status: "TRIAL",
      trialEndsAt,
    },
    include: { plan: true },
  });
  return created;
}

export async function GET(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) return notFound();

    const sub = await ensureSubscription(id);
    return ok({
      clinic: {
        id: clinic.id,
        slug: clinic.slug,
        nameRu: clinic.nameRu,
        nameUz: clinic.nameUz,
      },
      subscription: {
        id: sub.id,
        clinicId: sub.clinicId,
        planId: sub.planId,
        status: sub.status,
        trialEndsAt: sub.trialEndsAt,
        currentPeriodEndsAt: sub.currentPeriodEndsAt,
        cancelledAt: sub.cancelledAt,
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt,
        plan: sub.plan,
      },
    });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await requireSuper();
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

    // Auto-upsert: defensive if the 9b backfill missed this clinic.
    await ensureSubscription(id);

    const updated = await prisma.subscription.update({
      where: { clinicId: id },
      data: {
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
      meta: { changed: Object.keys(parsed.data) },
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
