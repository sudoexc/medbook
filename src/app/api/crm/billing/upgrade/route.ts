/**
 * POST /api/crm/billing/upgrade — clinic admin plan upgrade.
 *
 * The clinic's ADMIN, or the platform owner inside the clinic (owner request
 * 09.10.2026, docs/design/OWNER-ACCOUNT.md §0: SUPER_ADMIN used to get 403
 * here). A read only visit is refused like on createApiHandler.
 *
 * Body: `{ targetPlanSlug: "basic" | "pro" | "enterprise" }`
 *
 * Mints a DRAFT Invoice and returns `{ invoiceId, payUrl }`. The payUrl
 * points at the in-app pay screen where the user picks Click or Payme;
 * the actual provider checkout URL is built by
 * `/api/crm/billing/invoices/[id]/charge`.
 */
import { z } from "zod";

import { auth } from "@/lib/auth";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { isClinicAdmin } from "@/lib/permissions/clinic-admin";
import { assertNotViewOnly, impersonationStampFor } from "@/lib/view-only-guard";
import { err, ok } from "@/server/http";
import { createUpgradeInvoice } from "@/server/billing/invoice";

export const runtime = "nodejs";

const BodySchema = z.object({
  targetPlanSlug: z.enum(["basic", "pro", "enterprise"]),
});

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (!isClinicAdmin(session.user.role)) return err("Forbidden", 403);
  if (!session.user.clinicId) return err("ClinicNotSelected", 400);

  const ctx: TenantContext = {
    kind: "TENANT",
    clinicId: session.user.clinicId,
    userId: session.user.id,
    role: session.user.role,
    impersonation: impersonationStampFor(session.user),
  };
  const viewOnly = await assertNotViewOnly(request, ctx);
  if (viewOnly) return viewOnly;

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (e) {
    return err("ValidationError", 400, {
      issues: (e as { issues?: unknown }).issues,
    });
  }

  // Resolve current locale from the URL query so the simulate-pay link
  // matches the user's session. Falls back to "ru".
  const url = new URL(request.url);
  const localeParam = url.searchParams.get("locale");
  const locale: "ru" | "uz" = localeParam === "uz" ? "uz" : "ru";

  return runWithTenant(ctx, async () => {
    const sub = await prisma.subscription.findUnique({
      where: { clinicId: ctx.clinicId as string },
      include: { plan: true },
    });
    if (!sub) return err("NoSubscription", 409);

    const target = await prisma.plan.findUnique({
      where: { slug: parsed.targetPlanSlug },
      select: { id: true, slug: true },
    });
    if (!target) return err("PlanNotFound", 404);

    if (target.id === sub.planId && !sub.pendingPlanId) {
      return err("AlreadyOnPlan", 409);
    }

    const result = await createUpgradeInvoice({
      clinicId: ctx.clinicId as string,
      fromPlanId: sub.planId,
      toPlanId: target.id,
    });

    const payUrl = `/${locale}/crm/settings/billing/pay/${result.invoiceId}`;

    return ok({
      invoiceId: result.invoiceId,
      number: result.number,
      amountTiins: result.amountTiins.toString(),
      payUrl,
    });
  });
}
