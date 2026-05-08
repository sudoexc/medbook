/**
 * Phase 16 Wave 3 — pure-helper tests for refer-a-friend rewards.
 *
 * Covers the code generator (length + alphabet), reward computation
 * (clamping, rounding, edge cases), and default expiry (1 year out).
 */
import { describe, it, expect } from "vitest";

import {
  generateReferralCode,
  computeReferralReward,
  defaultRewardExpiry,
} from "@/lib/patient-experience/referral-reward";

describe("generateReferralCode", () => {
  it("produces an 8-character code", () => {
    const code = generateReferralCode();
    expect(code.length).toBe(8);
  });

  it("uses only the safe alphabet (no 0/O/1/I/L)", () => {
    const allowed = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
    for (let i = 0; i < 32; i += 1) {
      const code = generateReferralCode();
      expect(code).toMatch(allowed);
    }
  });

  it("is reasonably unique across many invocations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(generateReferralCode());
    // 200 draws from a 31^8 space → collisions effectively impossible.
    expect(seen.size).toBe(200);
  });
});

describe("computeReferralReward", () => {
  it("computes a 15% discount on a typical price", () => {
    const r = computeReferralReward({
      rewardPercent: 15,
      priceFinalTiins: 200_000_00, // 200 000 UZS
    });
    expect(r.discountTiins).toBe(30_000_00);
    expect(r.priceAfterTiins).toBe(170_000_00);
  });

  it("zero percent → zero discount", () => {
    const r = computeReferralReward({
      rewardPercent: 0,
      priceFinalTiins: 100_000,
    });
    expect(r.discountTiins).toBe(0);
    expect(r.priceAfterTiins).toBe(100_000);
  });

  it("zero price → zero discount", () => {
    const r = computeReferralReward({ rewardPercent: 15, priceFinalTiins: 0 });
    expect(r.discountTiins).toBe(0);
    expect(r.priceAfterTiins).toBe(0);
  });

  it("clamps absurd percentages to 50", () => {
    const r = computeReferralReward({
      rewardPercent: 200,
      priceFinalTiins: 1000,
    });
    expect(r.discountTiins).toBe(500);
    expect(r.priceAfterTiins).toBe(500);
  });

  it("never produces a negative price", () => {
    const r = computeReferralReward({
      rewardPercent: 50,
      priceFinalTiins: 1,
    });
    expect(r.discountTiins).toBeLessThanOrEqual(1);
    expect(r.priceAfterTiins).toBeGreaterThanOrEqual(0);
  });
});

describe("defaultRewardExpiry", () => {
  it("returns 1 year out from `now`", () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    const exp = defaultRewardExpiry(now);
    expect(exp.toISOString()).toBe("2027-05-06T12:00:00.000Z");
  });
});
