/**
 * Phase 10 — `computeQueueScore` unit coverage.
 *
 * Exercises each component (wait, urgency, vip, no-show, late, overdue),
 * the four bands, and the non-negative clamp.
 */
import { describe, it, expect } from "vitest";

import { computeQueueScore } from "@/lib/ai/queue-score";

const ZERO = {
  waitMin: 0,
  urgencyLevel: 0 as 0 | 1 | 2 | 3,
  isVip: false,
  noShowRisk: 0,
  isLate: false,
  hasOverdue: false,
};

describe("computeQueueScore", () => {
  it("zero input → score 0, band low, all components 0", () => {
    const r = computeQueueScore(ZERO);
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
    expect(r.components).toEqual({
      wait: 0,
      urgency: 0,
      vip: 0,
      noShowPenalty: 0,
      latePenalty: 0,
      overdueBoost: 0,
    });
  });

  it("wait component is 1 point per minute", () => {
    const r = computeQueueScore({ ...ZERO, waitMin: 25 });
    expect(r.components.wait).toBe(25);
    expect(r.score).toBe(25);
  });

  it("urgency component is 25 per level", () => {
    const r = computeQueueScore({ ...ZERO, urgencyLevel: 3 });
    expect(r.components.urgency).toBe(75);
    expect(r.score).toBe(75);
  });

  it("VIP adds a flat 30", () => {
    const r = computeQueueScore({ ...ZERO, isVip: true });
    expect(r.components.vip).toBe(30);
    expect(r.score).toBe(30);
  });

  it("no-show risk applies a negative penalty (-20 * risk)", () => {
    const r = computeQueueScore({ ...ZERO, waitMin: 50, noShowRisk: 0.5 });
    expect(r.components.noShowPenalty).toBe(-10);
    expect(r.score).toBe(40);
  });

  it("late + overdue stack on top of wait", () => {
    const r = computeQueueScore({
      ...ZERO,
      waitMin: 5,
      isLate: true,
      hasOverdue: true,
    });
    expect(r.components.latePenalty).toBe(15);
    expect(r.components.overdueBoost).toBe(10);
    expect(r.score).toBe(30);
    expect(r.band).toBe("normal");
  });

  it("score is clamped to a non-negative floor", () => {
    // Pure penalty case: only no-show pulls the score below zero.
    const r = computeQueueScore({ ...ZERO, noShowRisk: 1 });
    expect(r.components.noShowPenalty).toBe(-20);
    expect(r.score).toBe(0); // clamped
    expect(r.band).toBe("low");
  });

  it("bands: low (<30), normal (<70), high (<120), critical (else)", () => {
    expect(computeQueueScore({ ...ZERO, waitMin: 29 }).band).toBe("low");
    expect(computeQueueScore({ ...ZERO, waitMin: 30 }).band).toBe("normal");
    expect(computeQueueScore({ ...ZERO, waitMin: 69 }).band).toBe("normal");
    expect(computeQueueScore({ ...ZERO, waitMin: 70 }).band).toBe("high");
    expect(computeQueueScore({ ...ZERO, waitMin: 119 }).band).toBe("high");
    expect(computeQueueScore({ ...ZERO, waitMin: 120 }).band).toBe("critical");
    expect(computeQueueScore({ ...ZERO, waitMin: 999 }).band).toBe("critical");
  });

  it("realistic VIP urgent case → critical band", () => {
    const r = computeQueueScore({
      waitMin: 40,
      urgencyLevel: 3,
      isVip: true,
      noShowRisk: 0,
      isLate: false,
      hasOverdue: false,
    });
    // 40 + 75 + 30 = 145
    expect(r.score).toBe(145);
    expect(r.band).toBe("critical");
  });
});
