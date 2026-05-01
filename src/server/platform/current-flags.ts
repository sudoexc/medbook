/**
 * Phase 9d — Server-side helper for fetching feature flags for the current
 * session. Wraps `getFeatureFlags(clinicId)` and resolves a sane default
 * for sessions that don't carry a `clinicId`:
 *
 *   - SUPER_ADMIN with no impersonated clinic → ENTERPRISE_FLAGS (so the
 *     /admin nav stays unrestricted; the TENANT clinic scope is irrelevant).
 *   - Unauthenticated / missing clinicId → DEFAULT_FLAGS (Basic-equivalent),
 *     which is the safe minimum and matches the route-guard contract.
 *
 * Used by:
 *   - `src/components/layout/crm-sidebar.tsx` (server wrapper) — to filter
 *     menu items per the clinic's plan.
 *   - The `page.tsx` server components for gated routes (Telegram inbox,
 *     Call Center, Analytics-Pro funnels) — to call `notFound()` defensively.
 *   - The matching API routes — to return 404 instead of leaking pro-feature
 *     existence to a basic-tier admin.
 */
import "server-only";

import { auth } from "@/lib/auth";
import {
  DEFAULT_FLAGS,
  ENTERPRISE_FLAGS,
  getFeatureFlags,
  type FeatureFlags,
} from "@/lib/feature-flags";

/**
 * Resolve the feature flags for the currently signed-in user.
 *
 * Returns a fresh copy each call — callers may safely mutate.
 */
export async function getFeatureFlagsForCurrentSession(): Promise<FeatureFlags> {
  const session = await auth();
  const role = session?.user?.role;
  const clinicId = session?.user?.clinicId ?? null;

  if (role === "SUPER_ADMIN" && !clinicId) {
    return { ...ENTERPRISE_FLAGS };
  }
  if (!clinicId) {
    return { ...DEFAULT_FLAGS };
  }
  return await getFeatureFlags(clinicId);
}
