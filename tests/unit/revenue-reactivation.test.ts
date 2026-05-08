/**
 * Unit tests — Phase 14, Wave 2.
 *
 * Pure-function coverage for the reactivation engine:
 *   - `classifyLapse` — segment thresholds at 90 / 180 / 365
 *   - `shouldSendReactivation` — once-per-quarter idempotency gate
 *   - `deriveDormantSince` — dormancy timestamp derivation
 *
 * The DB-backed `findReactivationCandidates`, `enqueueReactivationFor`,
 * and `runReactivationScheduler` are exercised by the Wave 3 integration
 * tests (mocking Prisma here would obscure rather than illuminate).
 */
import { describe, it, expect } from "vitest";

import {
  classifyLapse,
  deriveDormantSince,
  shouldSendReactivation,
} from "@/server/revenue/reactivation";

describe("classifyLapse", () => {
  it("returns null below 90 days", () => {
    expect(classifyLapse(0)).toBeNull();
    expect(classifyLapse(89)).toBeNull();
  });

  it("classifies 90 as recent_lapse", () => {
    expect(classifyLapse(90)).toBe("recent_lapse");
  });

  it("classifies 179 as recent_lapse (upper edge)", () => {
    expect(classifyLapse(179)).toBe("recent_lapse");
  });

  it("classifies 180 as mid_lapse (lower edge)", () => {
    expect(classifyLapse(180)).toBe("mid_lapse");
  });

  it("classifies 365 as mid_lapse (upper edge, inclusive)", () => {
    expect(classifyLapse(365)).toBe("mid_lapse");
  });

  it("classifies 366 as deep_lapse", () => {
    expect(classifyLapse(366)).toBe("deep_lapse");
  });

  it("returns null for non-finite input", () => {
    expect(classifyLapse(Number.NaN)).toBeNull();
    expect(classifyLapse(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("shouldSendReactivation", () => {
  const now = new Date("2026-05-06T12:00:00.000Z");

  it("sends when no prior send", () => {
    const r = shouldSendReactivation({ lastSentAtList: [], now });
    expect(r.send).toBe(true);
  });

  it("skips when last send was 30 days ago", () => {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const r = shouldSendReactivation({
      lastSentAtList: [thirtyDaysAgo],
      now,
    });
    expect(r.send).toBe(false);
    expect(r.reason).toBe("recently_sent");
  });

  it("sends when last send was 100 days ago (past quarter window)", () => {
    const hundredDaysAgo = new Date(
      now.getTime() - 100 * 24 * 60 * 60 * 1000,
    );
    const r = shouldSendReactivation({
      lastSentAtList: [hundredDaysAgo],
      now,
    });
    expect(r.send).toBe(true);
  });

  it("skips on the boundary (exactly 90 days ago counts as inside window)", () => {
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const r = shouldSendReactivation({
      lastSentAtList: [ninetyDaysAgo],
      now,
    });
    expect(r.send).toBe(false);
  });

  it("considers the most recent send when multiple exist", () => {
    const oldest = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const r = shouldSendReactivation({
      lastSentAtList: [oldest, recent],
      now,
    });
    expect(r.send).toBe(false);
    expect(r.reason).toBe("recently_sent");
  });

  it("respects a custom quarterDays override", () => {
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const r = shouldSendReactivation({
      lastSentAtList: [fortyDaysAgo],
      now,
      quarterDays: 30,
    });
    expect(r.send).toBe(true);
  });
});

describe("deriveDormantSince", () => {
  it("returns null when lastVisitAt is null", () => {
    expect(deriveDormantSince(null)).toBeNull();
    expect(deriveDormantSince(undefined)).toBeNull();
  });

  it("adds 90 days to lastVisitAt", () => {
    const last = new Date("2026-01-01T00:00:00.000Z");
    const result = deriveDormantSince(last);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});
