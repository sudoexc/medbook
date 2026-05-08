/**
 * Phase 14 — `computeNoShowRisk` v2 structured breakdown.
 *
 * Asserts:
 *   - factor breakdown sums to the scalar score (within rounding, pre-clamp)
 *   - first-visit patients receive `firstVisitBump > 0`
 *   - high prior no-show ratio makes `historyRisk` dominant
 *   - unconfirmed BOOKED appointment yields `unconfirmedBump > 0`; confirmed
 *     (or far-ahead) does not
 *   - confidence tiers (low/medium/high) trip at the right history sizes
 *   - backward-compat: `computeNoShowRiskScore()` matches the Phase-10 scalar
 *     for canonical sample inputs (the same numbers exercised in
 *     `no-show-risk.test.ts`)
 */
import { describe, it, expect } from "vitest";

import {
  computeNoShowRisk,
  computeNoShowRiskScore,
} from "@/lib/ai/no-show-risk";

const BASE = {
  totalVisits: 0,
  noShows: 0,
  hasUnconfirmedReminder: false,
  hoursToAppointment: 48,
  isFirstVisit: false,
};

describe("computeNoShowRisk (v2 breakdown)", () => {
  it("factor sum equals score for an unclamped input", () => {
    const r = computeNoShowRisk({ ...BASE, totalVisits: 50, noShows: 0 });
    const sum =
      r.factors.historyRisk +
      r.factors.firstVisitBump +
      r.factors.unconfirmedBump +
      r.factors.farFutureBump +
      (r.factors.dayOfWeekBump ?? 0);
    expect(sum).toBeCloseTo(r.score, 10);
  });

  it("factor sum reproduces score even with multiple bumps active", () => {
    const r = computeNoShowRisk({
      totalVisits: 8,
      noShows: 1,
      hasUnconfirmedReminder: true,
      hoursToAppointment: 12,
      isFirstVisit: false,
    });
    const sum =
      r.factors.historyRisk +
      r.factors.firstVisitBump +
      r.factors.unconfirmedBump +
      r.factors.farFutureBump +
      (r.factors.dayOfWeekBump ?? 0);
    // No clamp needed at these values (well under 1).
    expect(sum).toBeCloseTo(r.score, 10);
    expect(r.factors.unconfirmedBump).toBeGreaterThan(0);
  });

  it("first-visit patient gets firstVisitBump > 0", () => {
    const r = computeNoShowRisk({ ...BASE, isFirstVisit: true });
    expect(r.factors.firstVisitBump).toBeGreaterThan(0);
    expect(r.factors.firstVisitBump).toBeCloseTo(0.1, 10);
  });

  it("non-first-visit patient gets firstVisitBump === 0", () => {
    const r = computeNoShowRisk({ ...BASE, totalVisits: 5, noShows: 0 });
    expect(r.factors.firstVisitBump).toBe(0);
  });

  it("high prior no-show ratio makes historyRisk the dominant factor", () => {
    const r = computeNoShowRisk({
      totalVisits: 20,
      noShows: 18,
      hasUnconfirmedReminder: false,
      hoursToAppointment: 48,
      isFirstVisit: false,
    });
    // (18+1)/(20+2) ≈ 0.864 — far above any of the bumps (0.05-0.10).
    expect(r.factors.historyRisk).toBeGreaterThan(0.8);
    expect(r.factors.historyRisk).toBeGreaterThan(r.factors.firstVisitBump);
    expect(r.factors.historyRisk).toBeGreaterThan(r.factors.unconfirmedBump);
    expect(r.factors.historyRisk).toBeGreaterThan(r.factors.farFutureBump);
  });

  it("unconfirmed BOOKED <24h to appointment → unconfirmedBump > 0", () => {
    const r = computeNoShowRisk({
      ...BASE,
      hasUnconfirmedReminder: true,
      hoursToAppointment: 12,
    });
    expect(r.factors.unconfirmedBump).toBeGreaterThan(0);
    expect(r.factors.unconfirmedBump).toBeCloseTo(0.1, 10);
  });

  it("confirmed (no unconfirmed reminder) → unconfirmedBump === 0", () => {
    const r = computeNoShowRisk({
      ...BASE,
      hasUnconfirmedReminder: false,
      hoursToAppointment: 12,
    });
    expect(r.factors.unconfirmedBump).toBe(0);
  });

  it("unconfirmed but far ahead (>=24h) → unconfirmedBump === 0", () => {
    const r = computeNoShowRisk({
      ...BASE,
      hasUnconfirmedReminder: true,
      hoursToAppointment: 48,
    });
    expect(r.factors.unconfirmedBump).toBe(0);
  });

  it("far-future (>168h) appointment → farFutureBump > 0", () => {
    const r = computeNoShowRisk({
      ...BASE,
      totalVisits: 50,
      noShows: 0,
      hoursToAppointment: 200,
    });
    expect(r.factors.farFutureBump).toBeCloseTo(0.05, 10);
  });

  describe("confidence tiers", () => {
    it("totalVisits = 0 → low", () => {
      expect(computeNoShowRisk({ ...BASE, totalVisits: 0 }).confidence).toBe(
        "low",
      );
    });
    it("totalVisits = 2 → low", () => {
      expect(computeNoShowRisk({ ...BASE, totalVisits: 2 }).confidence).toBe(
        "low",
      );
    });
    it("totalVisits = 3 → medium (boundary)", () => {
      expect(computeNoShowRisk({ ...BASE, totalVisits: 3 }).confidence).toBe(
        "medium",
      );
    });
    it("totalVisits = 9 → medium", () => {
      expect(computeNoShowRisk({ ...BASE, totalVisits: 9 }).confidence).toBe(
        "medium",
      );
    });
    it("totalVisits = 10 → high (boundary)", () => {
      expect(computeNoShowRisk({ ...BASE, totalVisits: 10 }).confidence).toBe(
        "high",
      );
    });
    it("totalVisits = 50 → high", () => {
      expect(computeNoShowRisk({ ...BASE, totalVisits: 50 }).confidence).toBe(
        "high",
      );
    });
  });

  describe("backward-compatible scalar API", () => {
    // Same canonical inputs the Phase-10 test exercises — the v2 score must
    // match the Phase-10 scalar exactly so detector thresholds don't drift.
    it("zero visits / zero no-shows → 0.5", () => {
      expect(computeNoShowRiskScore({ ...BASE })).toBeCloseTo(0.5, 10);
    });
    it("50 clean visits → ~0.0192 (1/52)", () => {
      const s = computeNoShowRiskScore({
        ...BASE,
        totalVisits: 50,
        noShows: 0,
      });
      expect(s).toBeCloseTo(1 / 52, 10);
    });
    it("first-visit bump → 0.6", () => {
      expect(
        computeNoShowRiskScore({ ...BASE, isFirstVisit: true }),
      ).toBeCloseTo(0.6, 10);
    });
    it("unconfirmed + 12h → 1/52 + 0.1", () => {
      expect(
        computeNoShowRiskScore({
          ...BASE,
          totalVisits: 50,
          noShows: 0,
          hasUnconfirmedReminder: true,
          hoursToAppointment: 12,
        }),
      ).toBeCloseTo(1 / 52 + 0.1, 10);
    });
    it("far-future bump → 1/52 + 0.05", () => {
      expect(
        computeNoShowRiskScore({
          ...BASE,
          totalVisits: 50,
          noShows: 0,
          hoursToAppointment: 200,
        }),
      ).toBeCloseTo(1 / 52 + 0.05, 10);
    });
    it("clamps to <= 1.0 with maxed bumps", () => {
      const s = computeNoShowRiskScore({
        totalVisits: 1,
        noShows: 1,
        hasUnconfirmedReminder: true,
        hoursToAppointment: 1,
        isFirstVisit: true,
      });
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThanOrEqual(0);
    });
    it("legacy `.risk` alias matches `.score`", () => {
      const r = computeNoShowRisk({ ...BASE, totalVisits: 7, noShows: 1 });
      expect(r.risk).toBe(r.score);
    });
  });

  describe("optional dayOfWeek bump", () => {
    it("omitted dayOfWeek → no `dayOfWeekBump` key, score unchanged", () => {
      const base = computeNoShowRisk({
        ...BASE,
        totalVisits: 50,
        noShows: 0,
      });
      expect(base.factors.dayOfWeekBump).toBeUndefined();
    });
    it("Monday (1) and Saturday (6) trigger a small +0.02 bump", () => {
      const mon = computeNoShowRisk({
        ...BASE,
        totalVisits: 50,
        noShows: 0,
        dayOfWeek: 1,
      });
      const sat = computeNoShowRisk({
        ...BASE,
        totalVisits: 50,
        noShows: 0,
        dayOfWeek: 6,
      });
      expect(mon.factors.dayOfWeekBump).toBeCloseTo(0.02, 10);
      expect(sat.factors.dayOfWeekBump).toBeCloseTo(0.02, 10);
    });
    it("other weekdays → 0", () => {
      const wed = computeNoShowRisk({
        ...BASE,
        totalVisits: 50,
        noShows: 0,
        dayOfWeek: 3,
      });
      expect(wed.factors.dayOfWeekBump).toBe(0);
    });
  });
});
