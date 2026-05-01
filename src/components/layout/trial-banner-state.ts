/**
 * Phase 9e — pure helpers for the trial / past-due banner state machine.
 *
 * Lives in a leaf module with **zero** server-only imports (no next-auth,
 * no `next-intl/server`, no Prisma) so vitest in Node mode can load it
 * without choking on the next/server bridge that next-auth pulls in. The
 * server-side `<TrialBanner />` renderer in `trial-banner.tsx` imports
 * from here; the layout helper in `server/platform/current-subscription.ts`
 * imports the type from here too — both layers agree on a single source
 * of truth.
 *
 * Visibility / threshold contract:
 *
 *   - TRIAL daysLeft >  7   → hidden  (early honeymoon, no banner spam)
 *   - TRIAL daysLeft 7..3   → "info"  (yellow / neutral warning)
 *   - TRIAL daysLeft 2..0   → "warning" (red, last 48h-ish)
 *   - PAST_DUE              → "expired" (red, grace-period messaging)
 *   - ACTIVE / CANCELLED    → hidden
 *   - null subscription     → hidden
 */

/**
 * Compact, render-friendly snapshot of the current clinic's subscription.
 *
 * Returned by `getCurrentSubscription()` (server) and consumed by
 * `<TrialBanner />` (server) and `computeBannerState` (pure). `daysLeft`
 * is a denormalised convenience for callers that want to inspect the
 * snapshot — `computeBannerState` recomputes from `trialEndsAt` so the
 * component and the helper agree on the boundary.
 */
export type CurrentSubscription = {
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  planSlug: string;
  /** Calendar-days remaining in the trial (rounded up, clamped at 0). `null` when status !== "TRIAL". */
  daysLeft: number | null;
};

export type BannerState =
  | { kind: "hidden" }
  | { kind: "info"; daysLeft: number }
  | { kind: "warning"; daysLeft: number }
  | {
      kind: "expired";
      gracePeriodEndsAt: Date | null;
    };

/**
 * Returns calendar-days remaining until `trialEndsAt`, rounded UP via
 * `Math.ceil` so 0.4 days remaining shows "1 day" rather than "0".
 *
 *   - `null` `trialEndsAt`           → `null` (caller decides what to do)
 *   - `trialEndsAt <= now`           → `0`    (clamped — already expired,
 *                                              the scheduler hasn't ticked
 *                                              yet but the UI shows 0)
 *   - otherwise                      → ceil((trialEndsAt - now) / 1 day)
 */
export function computeTrialDaysLeft(
  trialEndsAt: Date | null,
  now: Date,
): number | null {
  if (!trialEndsAt) return null;
  const ms = trialEndsAt.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/**
 * Pure derivation of the banner's visual state from a `CurrentSubscription`
 * snapshot + the wall clock. See file-level docstring for the full
 * threshold contract.
 */
export function computeBannerState(
  sub: CurrentSubscription | null,
  now: Date,
): BannerState {
  if (!sub) return { kind: "hidden" };
  if (sub.status === "ACTIVE" || sub.status === "CANCELLED") {
    return { kind: "hidden" };
  }
  if (sub.status === "PAST_DUE") {
    return { kind: "expired", gracePeriodEndsAt: sub.currentPeriodEndsAt };
  }
  // status === "TRIAL"
  const daysLeft = computeTrialDaysLeft(sub.trialEndsAt, now);
  if (daysLeft === null) return { kind: "hidden" };
  if (daysLeft > 7) return { kind: "hidden" };
  if (daysLeft <= 2) return { kind: "warning", daysLeft };
  return { kind: "info", daysLeft };
}
