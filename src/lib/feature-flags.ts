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
  // Phase 19 Wave 1 — usage quotas. `-1` is the "unlimited" sentinel and is
  // honoured by `evaluateLimit` in `src/server/billing/plan-limits.ts`. The
  // numeric keys are evaluated against `getClinicUsage()`; the two booleans
  // gate UI affordances (white-label theming, custom subdomain). The
  // `maxSmsPerMonth` quota was deleted in Wave 3 of
  // `docs/TZ-sms-removal.md` together with the underlying counter.
  maxPatients: number;
  maxAppointmentsPerMonth: number;
  maxStorageMb: number;
  hasWhiteLabel: boolean;
  hasCustomSubdomain: boolean;
};

export const DEFAULT_FLAGS: FeatureFlags = {
  hasTelegramInbox: false,
  hasCallCenter: false,
  hasAnalyticsPro: false,
  maxBranches: 1,
  maxUsers: 5,
  // Mirror the seeded `basic` plan in
  // `prisma/migrations/20260507160000_phase19_w1_plan_limits/migration.sql`.
  // Used as the fallback when a clinic has no subscription, has been
  // CANCELLED, or `parsePlanFeatures` is given an unparseable value.
  maxPatients: 50,
  maxAppointmentsPerMonth: 100,
  maxStorageMb: 500,
  hasWhiteLabel: false,
  hasCustomSubdomain: false,
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
    // Phase 19 Wave 1 — same fall-through pattern: missing or malformed
    // values land on the basic-tier DEFAULT_FLAGS values.
    maxPatients: pickInt("maxPatients"),
    maxAppointmentsPerMonth: pickInt("maxAppointmentsPerMonth"),
    maxStorageMb: pickInt("maxStorageMb"),
    hasWhiteLabel: pickBool("hasWhiteLabel"),
    hasCustomSubdomain: pickBool("hasCustomSubdomain"),
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
  // Phase 19 Wave 1 — `-1` is the unlimited sentinel honoured by
  // `evaluateLimit` (see `src/server/billing/plan-limits.ts`). Both
  // white-label affordances are on for enterprise.
  maxPatients: -1,
  maxAppointmentsPerMonth: -1,
  maxStorageMb: -1,
  hasWhiteLabel: true,
  hasCustomSubdomain: true,
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

/**
 * The one rule for a subscription's effective flags, shared by the server
 * resolver (`getFeatureFlags`) and the platform billing page (audit G5-14:
 * its card read `plan.features` whatever the status, and showed «Колл-центр
 * ✓» for a cancelled clinic whose call center was already gone).
 *
 *   TRIAL / ACTIVE / PAST_DUE → the plan's flags (PAST_DUE is a grace period)
 *   CANCELLED, no subscription → DEFAULT_FLAGS (Basic-equivalent)
 */
export function effectiveFlags(
  sub: { status: string; planFeatures: unknown } | null,
): FeatureFlags {
  if (!sub) return { ...DEFAULT_FLAGS };
  switch (sub.status) {
    case "TRIAL":
    case "ACTIVE":
    case "PAST_DUE":
      return parsePlanFeatures(sub.planFeatures);
    default:
      return { ...DEFAULT_FLAGS };
  }
}

/** The on/off features a tariff change can switch, in the order shown. */
export const SWITCHABLE_FEATURES = [
  "hasCallCenter",
  "hasTelegramInbox",
  "hasAnalyticsPro",
  "hasWhiteLabel",
  "hasCustomSubdomain",
] as const;

export type SwitchableFeature = (typeof SWITCHABLE_FEATURES)[number];

/**
 * Pure: which on/off features a change from `before` to `after` turns off
 * and which it turns on, for the confirmation before a plan or status change
 * (audit G5-14).
 */
export function flagChanges(
  before: FeatureFlags,
  after: FeatureFlags,
): { off: SwitchableFeature[]; on: SwitchableFeature[] } {
  const off: SwitchableFeature[] = [];
  const on: SwitchableFeature[] = [];
  for (const key of SWITCHABLE_FEATURES) {
    if (before[key] && !after[key]) off.push(key);
    if (!before[key] && after[key]) on.push(key);
  }
  return { off, on };
}
