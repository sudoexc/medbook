/**
 * Phase 10 — `computeNoShowRisk` unit coverage.
 *
 * Asserts Laplace base, each situational bump, the 0..1 clamp, and the band
 * thresholds.
 */
import { describe, it, expect } from "vitest";

import { computeNoShowRisk } from "@/lib/ai/no-show-risk";

const BASE = {
  totalVisits: 0,
  noShows: 0,
  hasUnconfirmedReminder: false,
  hoursToAppointment: 48,
  isFirstVisit: false,
};

describe("computeNoShowRisk", () => {
  it("zero visits, zero no-shows → Laplace base 1/2 = 0.5", () => {
    const r = computeNoShowRisk({ ...BASE });
    // (0+1)/(0+2) = 0.5 → med band by threshold (>= 0.35)
    expect(r.risk).toBeCloseTo(0.5, 5);
    expect(r.band).toBe("high");
  });

  it("many clean visits → low risk", () => {
    // (0+1)/(50+2) ≈ 0.019
    const r = computeNoShowRisk({ ...BASE, totalVisits: 50, noShows: 0 });
    expect(r.risk).toBeLessThan(0.05);
    expect(r.band).toBe("low");
  });

  it("first-visit bump adds +0.10", () => {
    // Without bump: 1/2 = 0.5; with first-visit: 0.6
    const r = computeNoShowRisk({ ...BASE, isFirstVisit: true });
    expect(r.risk).toBeCloseTo(0.6, 5);
  });

  it("unconfirmed reminder + <24h adds +0.10", () => {
    const r = computeNoShowRisk({
      ...BASE,
      totalVisits: 50,
      noShows: 0,
      hasUnconfirmedReminder: true,
      hoursToAppointment: 12,
    });
    // base ≈ 0.0192 + 0.10 = ~0.119
    expect(r.risk).toBeGreaterThan(0.1);
    expect(r.risk).toBeLessThan(0.13);
    expect(r.band).toBe("low"); // still under 0.15
  });

  it("unconfirmed reminder is no-op when >=24h ahead", () => {
    const r = computeNoShowRisk({
      ...BASE,
      totalVisits: 50,
      noShows: 0,
      hasUnconfirmedReminder: true,
      hoursToAppointment: 48,
    });
    expect(r.risk).toBeCloseTo(1 / 52, 5); // no bump
  });

  it("far-future bump adds +0.05 when >168h", () => {
    const r = computeNoShowRisk({
      ...BASE,
      totalVisits: 50,
      noShows: 0,
      hoursToAppointment: 200,
    });
    expect(r.risk).toBeCloseTo(1 / 52 + 0.05, 5);
  });

  it("clamps to [0, 1]", () => {
    const r = computeNoShowRisk({
      totalVisits: 1,
      noShows: 1, // (1+1)/(1+2) = 0.667
      hasUnconfirmedReminder: true,
      hoursToAppointment: 1,
      isFirstVisit: true,
    });
    // 0.667 + 0.1 + 0.1 = 0.867, then clamp safe
    expect(r.risk).toBeLessThanOrEqual(1);
    expect(r.risk).toBeGreaterThanOrEqual(0);
    expect(r.band).toBe("high");
  });

  it("bands: <0.15 low, <0.35 med, else high", () => {
    expect(computeNoShowRisk({ ...BASE, totalVisits: 50, noShows: 0 }).band).toBe(
      "low",
    );
    // Construct a med band: (1+1)/(7+2) ≈ 0.222
    expect(
      computeNoShowRisk({ ...BASE, totalVisits: 7, noShows: 1 }).band,
    ).toBe("med");
    // High: 0.5 base
    expect(computeNoShowRisk(BASE).band).toBe("high");
  });
});
