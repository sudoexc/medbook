/**
 * Phase 9e — `computeBannerState` pure helper.
 *
 * The CRM trial-countdown / past-due banner derives its visual state from a
 * `CurrentSubscription` snapshot via `computeBannerState(sub, now)`. This
 * test pins the visibility window (TRIAL daysLeft <= 7) and the warning
 * threshold (daysLeft <= 2) so a refactor of the renderer can't drift the
 * UX boundary silently.
 *
 * The helper is also where `computeTrialDaysLeft` rounding lives — covered
 * here as a sub-suite so we don't need a third test file.
 */
import { describe, it, expect } from "vitest";

import {
  computeBannerState,
  computeTrialDaysLeft,
  type CurrentSubscription,
} from "@/components/layout/trial-banner-state";

const NOW = new Date("2026-05-01T12:00:00.000Z");

function trialEndingIn(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

function makeSub(
  partial: Partial<CurrentSubscription> & { status: CurrentSubscription["status"] },
): CurrentSubscription {
  // Default `daysLeft` to whatever computeTrialDaysLeft would derive — the
  // banner helper recomputes from `trialEndsAt` anyway, so this field is a
  // convenience for callers that want to inspect the snapshot directly.
  const trialEndsAt = partial.trialEndsAt ?? null;
  return {
    status: partial.status,
    trialEndsAt,
    currentPeriodEndsAt: partial.currentPeriodEndsAt ?? null,
    planSlug: partial.planSlug ?? "pro",
    daysLeft:
      partial.daysLeft ??
      (partial.status === "TRIAL" ? computeTrialDaysLeft(trialEndsAt, NOW) : null),
  };
}

describe("computeBannerState", () => {
  it("null subscription → hidden", () => {
    expect(computeBannerState(null, NOW)).toEqual({ kind: "hidden" });
  });

  it("ACTIVE → hidden (paying customer, no banner)", () => {
    const sub = makeSub({ status: "ACTIVE" });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "hidden" });
  });

  it("CANCELLED → hidden (already gone, banner would be noise)", () => {
    const sub = makeSub({ status: "CANCELLED" });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "hidden" });
  });

  it("TRIAL with 8 days left → hidden (outside the visibility window)", () => {
    const sub = makeSub({ status: "TRIAL", trialEndsAt: trialEndingIn(8) });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "hidden" });
  });

  it("TRIAL with exactly 7 days left → info", () => {
    const sub = makeSub({ status: "TRIAL", trialEndsAt: trialEndingIn(7) });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "info", daysLeft: 7 });
  });

  it("TRIAL with 5 days left → info", () => {
    const sub = makeSub({ status: "TRIAL", trialEndsAt: trialEndingIn(5) });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "info", daysLeft: 5 });
  });

  it("TRIAL with 3 days left → info (last day of info window)", () => {
    const sub = makeSub({ status: "TRIAL", trialEndsAt: trialEndingIn(3) });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "info", daysLeft: 3 });
  });

  it("TRIAL with 2 days left → warning (transition into red)", () => {
    const sub = makeSub({ status: "TRIAL", trialEndsAt: trialEndingIn(2) });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "warning", daysLeft: 2 });
  });

  it("TRIAL with 1 day left → warning", () => {
    const sub = makeSub({ status: "TRIAL", trialEndsAt: trialEndingIn(1) });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "warning", daysLeft: 1 });
  });

  it("TRIAL with 0 days left (last hours) → warning", () => {
    // 6 hours left → ceil to 1 day, still warning.
    const sub = makeSub({
      status: "TRIAL",
      trialEndsAt: new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
    });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "warning", daysLeft: 1 });
  });

  it("TRIAL whose trialEndsAt has just passed (scheduler hasn't ticked) → warning daysLeft 0", () => {
    const sub = makeSub({
      status: "TRIAL",
      trialEndsAt: new Date(NOW.getTime() - 60_000),
    });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "warning", daysLeft: 0 });
  });

  it("TRIAL with null trialEndsAt → hidden (open-ended trial, no countdown)", () => {
    const sub = makeSub({ status: "TRIAL", trialEndsAt: null });
    expect(computeBannerState(sub, NOW)).toEqual({ kind: "hidden" });
  });

  it("PAST_DUE → expired (regardless of date fields)", () => {
    const periodEnd = new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000);
    const sub = makeSub({
      status: "PAST_DUE",
      trialEndsAt: new Date(NOW.getTime() - 60_000),
      currentPeriodEndsAt: periodEnd,
    });
    expect(computeBannerState(sub, NOW)).toEqual({
      kind: "expired",
      gracePeriodEndsAt: periodEnd,
    });
  });

  it("PAST_DUE with no currentPeriodEndsAt → expired with null gracePeriodEndsAt", () => {
    const sub = makeSub({
      status: "PAST_DUE",
      trialEndsAt: new Date(NOW.getTime() - 60_000),
      currentPeriodEndsAt: null,
    });
    expect(computeBannerState(sub, NOW)).toEqual({
      kind: "expired",
      gracePeriodEndsAt: null,
    });
  });
});

describe("computeTrialDaysLeft", () => {
  it("returns null when trialEndsAt is null", () => {
    expect(computeTrialDaysLeft(null, NOW)).toBeNull();
  });

  it("ceils partial days up", () => {
    // 1.4 days → 2.
    const d = new Date(NOW.getTime() + 1.4 * 24 * 60 * 60 * 1000);
    expect(computeTrialDaysLeft(d, NOW)).toBe(2);
  });

  it("returns 0 for an already-passed deadline", () => {
    const d = new Date(NOW.getTime() - 60_000);
    expect(computeTrialDaysLeft(d, NOW)).toBe(0);
  });

  it("returns 0 for deadline === now", () => {
    expect(computeTrialDaysLeft(NOW, NOW)).toBe(0);
  });

  it("returns whole days for whole-day futures", () => {
    expect(computeTrialDaysLeft(trialEndingIn(7), NOW)).toBe(7);
    expect(computeTrialDaysLeft(trialEndingIn(30), NOW)).toBe(30);
  });
});
