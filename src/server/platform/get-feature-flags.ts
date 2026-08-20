/**
 * Phase 9b — DB-bound resolver for feature flags.
 *
 * Lives under `src/server/` (not `src/lib/`) so the prisma import never reaches
 * a client component bundle. The pure types + helpers it depends on come from
 * `@/lib/feature-flags`, which is safe to import from anywhere.
 *
 * Behaviour matrix (Stripe-style — PAST_DUE keeps access during a grace
 * period; the billing UI in Phase 9c surfaces the warning to the admin):
 *
 *   TRIAL / ACTIVE / PAST_DUE → flags from the linked plan
 *   CANCELLED                  → DEFAULT_FLAGS (Basic-equivalent)
 *   no subscription            → DEFAULT_FLAGS
 *
 * The `clinicId` is passed explicitly to `where`, so the tenant-scope Prisma
 * extension treats the call as already-scoped and does not duplicate the
 * column — making this helper safe to call from TENANT, SUPER_ADMIN, and
 * SYSTEM contexts.
 *
 * The read itself runs under `runUnscoped` because several callers are React
 * server components (sidebar, gated pages, Mini App layout) that render with
 * NO AsyncLocalStorage context at all — `runWithTenant` in a layout does not
 * span the RSC tree. The fail-closed extension would otherwise reject those
 * reads. Isolation is preserved by the explicit `where: { clinicId }`, and
 * every caller passes a clinicId it already authorized (session claim or a
 * SYSTEM-resolved clinic row).
 */

import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant-context";
import {
  DEFAULT_FLAGS,
  parsePlanFeatures,
  type FeatureFlags,
} from "@/lib/feature-flags";

export async function getFeatureFlags(
  clinicId: string
): Promise<FeatureFlags> {
  const sub = await runUnscoped(
    "feature flags: read subscription for an explicitly-passed clinicId (RSC callers have no ALS context)",
    () =>
      prisma.subscription.findUnique({
        where: { clinicId },
        include: { plan: true },
      }),
  );

  if (!sub) return { ...DEFAULT_FLAGS };

  switch (sub.status) {
    case "TRIAL":
    case "ACTIVE":
    case "PAST_DUE":
      return parsePlanFeatures(sub.plan.features);
    case "CANCELLED":
    default:
      return { ...DEFAULT_FLAGS };
  }
}
