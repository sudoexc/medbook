/**
 * Phase 9b — Feature flag types + pure helpers.
 * Phase 9d — adds pure nav-filter helper used by the CRM sidebar.
 *
 * This module is intentionally **prisma-free** so client components can import
 * `ENTERPRISE_FLAGS`, `computeVisibleNav`, and the type from here without
 * dragging the database client into the browser bundle. The DB-bound resolver
 * `getFeatureFlags(clinicId)` lives in `@/server/platform/get-feature-flags`.
 */

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
