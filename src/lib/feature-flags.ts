/**
 * Phase 9b — Feature flag helper.
 * Phase 9d — adds session-aware fetch + pure nav-filter helper used by the
 *           CRM sidebar render path and the route-level guards.
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
 * and SYSTEM contexts without modification.
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

/**
 * Effective enterprise-equivalent flags. Used as the fallback for SUPER_ADMIN
 * sessions that have not yet impersonated a clinic (no `clinicId` on the
 * session) — they should see every nav item, since gating is a per-tenant
 * concern. Mirrors the seed enterprise plan from
 * `20260501091536_add_plans_and_subscriptions/migration.sql`.
 */
export const ENTERPRISE_FLAGS: FeatureFlags = {
  hasTelegramInbox: true,
  hasCallCenter: true,
  hasAnalyticsPro: true,
  maxBranches: 50,
  maxUsers: 500,
};

/**
 * The minimum shape `computeVisibleNav` needs from each nav item — duplicated
 * here so the pure helper has zero React / lucide-react imports and the unit
 * tests can run DB-less. Production callers extend this with `icon`, badges,
 * etc. and the helper will preserve the extra keys via the generic.
 */
export type FeatureGatedItem = {
  /** Route segment, e.g. "telegram" or "call-center". */
  href: string;
  /**
   * Optional gate. When the named flag resolves to `false`, the item is
   * filtered out. Only the boolean keys of `FeatureFlags` are valid gates —
   * the numeric quotas (`maxBranches`, `maxUsers`) are not nav gates.
   */
  feature?: "hasTelegramInbox" | "hasCallCenter" | "hasAnalyticsPro";
};

export type FeatureGatedGroup<TItem extends FeatureGatedItem> = {
  items: TItem[];
  // any other keys (e.g. `labelKey`) survive untouched.
  [key: string]: unknown;
};

/**
 * Pure nav filter. Drops items whose `feature` flag is off and groups whose
 * filtered `items` array becomes empty. Returns a fresh array; the input is
 * not mutated. Items without a `feature` key are kept as-is (unconditional).
 *
 * Generic over the item type so the CRM sidebar can carry its `icon`,
 * `labelKey`, `badgeKey`, … without coupling this helper to React.
 */
export function computeVisibleNav<TItem extends FeatureGatedItem>(
  groups: ReadonlyArray<FeatureGatedGroup<TItem>>,
  flags: FeatureFlags
): Array<FeatureGatedGroup<TItem>> {
  const out: Array<FeatureGatedGroup<TItem>> = [];
  for (const group of groups) {
    const items = group.items.filter((item) => {
      if (!item.feature) return true;
      return flags[item.feature] === true;
    });
    if (items.length === 0) continue;
    out.push({ ...group, items });
  }
  return out;
}
