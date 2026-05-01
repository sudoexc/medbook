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
 */

import { prisma } from "@/lib/prisma";
import {
  DEFAULT_FLAGS,
  parsePlanFeatures,
  type FeatureFlags,
} from "@/lib/feature-flags";

export async function getFeatureFlags(
  clinicId: string
): Promise<FeatureFlags> {
  const sub = await prisma.subscription.findUnique({
    where: { clinicId },
    include: { plan: true },
  });

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
