/**
 * Phase 19 Wave 1 — pure-helper tests for `evaluateLimit`.
 *
 * Pure path only — no prisma, no audit, no async. Confirms the warn/block
 * thresholds and the `-1` unlimited sentinel.
 */
import { describe, expect, it } from "vitest";

import { evaluateLimit } from "@/server/billing/plan-limits";

describe("evaluateLimit", () => {
  it("max = -1 → ok regardless of current", () => {
    expect(evaluateLimit(0, -1, true).ok).toBe(true);
    expect(evaluateLimit(9999, -1, true).ok).toBe(true);
    expect(evaluateLimit(9999, -1, false).ok).toBe(true);
  });

  it("max = 0 → ok (treated as unlimited / not-applicable)", () => {
    expect(evaluateLimit(0, 0, true).ok).toBe(true);
    expect(evaluateLimit(50, 0, true).ok).toBe(true);
  });

  it("50 / 100 free plan → ok (under 80%)", () => {
    const r = evaluateLimit(50, 100, true);
    expect(r.ok).toBe(true);
  });

  it("80 / 100 free plan → warn (at the boundary)", () => {
    const r = evaluateLimit(80, 100, true);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.kind).toBe("warn");
      expect(r.pctUsed).toBe(80);
      expect(r.current).toBe(80);
      expect(r.max).toBe(100);
    }
  });

  it("99 / 100 free plan → warn (still under max)", () => {
    const r = evaluateLimit(99, 100, true);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.kind).toBe("warn");
  });

  it("100 / 100 free plan → block", () => {
    const r = evaluateLimit(100, 100, true);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.kind).toBe("block");
  });

  it("200 / 100 free plan → block (over max)", () => {
    const r = evaluateLimit(200, 100, true);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.kind).toBe("block");
      expect(r.pctUsed).toBe(200);
    }
  });

  it("200 / 100 paying plan → warn (never block)", () => {
    const r = evaluateLimit(200, 100, false);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.kind).toBe("warn");
  });

  it("80 / 100 paying plan → warn (same as Free at the warn band)", () => {
    const r = evaluateLimit(80, 100, false);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.kind).toBe("warn");
  });

  it("propagates the supplied quota key into the result", () => {
    const r = evaluateLimit(100, 100, true, "maxAppointmentsPerMonth");
    if (r.ok === false) expect(r.quota).toBe("maxAppointmentsPerMonth");
  });
});
