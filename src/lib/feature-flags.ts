/**
 * Phase 9b — Feature flag helper.
 *
 * Each clinic carries (at most) one `Subscription` pointing at a `Plan`. The
 * plan stores a `features` JSON blob that gates Telegram inbox, call center,
 * pro analytics, and per-tier maximums (branches, users). This helper resolves
 * those flags into a strongly-typed shape callers can consume.
 *
 * Behaviour matrix (Stripe-style — PAST_DUE keeps access during a grace
 * period; the billing UI in Phase 9c surfaces the warning to the admin):
 *
 *   TRIAL / ACTIVE / PAST_DUE → flags from the linked plan
 *   CANCELLED                  → DEFAULT_FLAGS (Basic-equivalent)
 *   no subscription            → DEFAULT_FLAGS
 *
 * Defensive parsing: if `plan.features` is missing a key or has the wrong
 * type, that single key falls back to its `DEFAULT_FLAGS` value rather than
 * throwing — billing data should never crash a render path.
 *
 * Tenant scoping note: this is an admin/billing read keyed on a known
 * `clinicId`. The query passes `clinicId` explicitly, so the tenant-scope
 * extension is a no-op; the helper works correctly under TENANT, SUPER_ADMIN,
 * and SYSTEM contexts without modification. Phase 9c will wire it into the
 * billing UI; Phase 9d will use it for navigation gating. No production code
 * imports it yet — it's staged here for the next phases.
 */

import { prisma } from "./prisma";

export type FeatureFlags = {
  hasTelegramInbox: boolean;
  hasCallCenter: boolean;
  hasAnalyticsPro: boolean;
  maxBranches: number;
  maxUsers: number;
};

export const DEFAULT_FLAGS: FeatureFlags = {
  hasTelegramInbox: false,
  hasCallCenter: false,
  hasAnalyticsPro: false,
  maxBranches: 1,
  maxUsers: 5,
};

/**
 * Parse a raw `Plan.features` JSON value into the strongly-typed
 * `FeatureFlags` shape. Each key falls back to its DEFAULT_FLAGS value when
 * missing or of the wrong runtime type. Never throws.
 */
export function parsePlanFeatures(raw: unknown): FeatureFlags {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_FLAGS };
  }
  const rec = raw as Record<string, unknown>;
  const pickBool = (key: keyof FeatureFlags): boolean => {
    const v = rec[key as string];
    return typeof v === "boolean" ? v : (DEFAULT_FLAGS[key] as boolean);
  };
  const pickInt = (key: keyof FeatureFlags): number => {
    const v = rec[key as string];
    return typeof v === "number" && Number.isFinite(v)
      ? v
      : (DEFAULT_FLAGS[key] as number);
  };
  return {
    hasTelegramInbox: pickBool("hasTelegramInbox"),
    hasCallCenter: pickBool("hasCallCenter"),
    hasAnalyticsPro: pickBool("hasAnalyticsPro"),
    maxBranches: pickInt("maxBranches"),
    maxUsers: pickInt("maxUsers"),
  };
}

/**
 * Resolve the effective feature flags for a clinic.
 *
 * - TRIAL / ACTIVE / PAST_DUE → flags from the linked Plan
 * - CANCELLED or no subscription → DEFAULT_FLAGS
 *
 * The `clinicId` is passed explicitly to `where`, so the tenant-scope Prisma
 * extension treats the call as already-scoped and does not duplicate the
 * column — making this helper safe to call from TENANT, SUPER_ADMIN, and
 * SYSTEM contexts.
 */
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
