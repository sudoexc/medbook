/**
 * Phase 9e — Server-side helper that fetches the current session's clinic
 * subscription for the trial-countdown banner.
 *
 * The compact `CurrentSubscription` shape and the `computeTrialDaysLeft`
 * helper live in `@/components/layout/trial-banner-state` so vitest can
 * import them without dragging in next-auth's bridge — see the docstring
 * there for the rationale. This module is the server-only entry: it pulls
 * the row from Prisma, denormalises `daysLeft`, and returns `null` for
 * sessions that should NOT see the banner at all:
 *
 *   - unauthenticated requests
 *   - SUPER_ADMIN with no impersonated clinic (they're on /admin, not a tenant)
 *   - clinicId present but no Subscription row (defensive — shouldn't happen
 *     in practice because the seed creates one per clinic, but a missing row
 *     is a cleaner "no banner" than a synthetic placeholder)
 *
 * Tenant scoping note: `prisma.subscription.findUnique({ where: { clinicId } })`
 * is keyed on the clinic explicitly, so the tenant-scope Prisma extension
 * is a no-op — safe under TENANT, SUPER_ADMIN-with-clinic, and SYSTEM.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  computeTrialDaysLeft,
  type CurrentSubscription,
} from "@/components/layout/trial-banner-state";

export type { CurrentSubscription };
export { computeTrialDaysLeft };

export async function getCurrentSubscription(): Promise<CurrentSubscription | null> {
  const session = await auth();
  const clinicId = session?.user?.clinicId ?? null;
  if (!clinicId) {
    // SUPER_ADMIN-without-clinic and unauthenticated both land here.
    return null;
  }

  const sub = await prisma.subscription.findUnique({
    where: { clinicId },
    include: { plan: { select: { slug: true } } },
  });
  if (!sub) return null;

  const now = new Date();
  const daysLeft =
    sub.status === "TRIAL" ? computeTrialDaysLeft(sub.trialEndsAt, now) : null;

  return {
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEndsAt: sub.currentPeriodEndsAt,
    planSlug: sub.plan.slug,
    daysLeft,
  };
}
