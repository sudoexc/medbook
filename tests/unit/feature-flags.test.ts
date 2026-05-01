/**
 * Phase 9b — `getFeatureFlags` resolution.
 *
 * DB-less. We mock `@/lib/prisma` so the helper calls a fake `subscription
 * .findUnique`, then assert the returned flag shape for each branch of the
 * status / payload matrix.
 *
 * The helper passes `clinicId` explicitly to `where`, so the tenant-scope
 * extension is a no-op for these calls — we don't need to install the
 * `vi.hoisted` $extends capture used elsewhere.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: {
      findUnique: mockState.findUnique,
    },
  },
}));

import { parsePlanFeatures, DEFAULT_FLAGS } from "@/lib/feature-flags";
import { getFeatureFlags } from "@/server/platform/get-feature-flags";

const PRO_FEATURES = {
  hasTelegramInbox: true,
  hasCallCenter: true,
  hasAnalyticsPro: false,
  maxBranches: 3,
  maxUsers: 20,
};

const ENTERPRISE_FEATURES = {
  hasTelegramInbox: true,
  hasCallCenter: true,
  hasAnalyticsPro: true,
  maxBranches: 50,
  maxUsers: 500,
};

const BASIC_FEATURES = {
  hasTelegramInbox: false,
  hasCallCenter: false,
  hasAnalyticsPro: false,
  maxBranches: 1,
  maxUsers: 5,
};

function makeSubscription(
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED",
  features: unknown
) {
  return {
    id: "sub_x",
    clinicId: "c1",
    planId: "p_x",
    status,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    plan: {
      id: "p_x",
      slug: "pro",
      nameRu: "Pro",
      nameUz: "Pro",
      priceMonth: "1500000",
      currency: "UZS",
      features,
      isActive: true,
      sortOrder: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

describe("getFeatureFlags", () => {
  beforeEach(() => {
    mockState.findUnique.mockReset();
  });

  it("TRIAL → returns plan flags (Pro tier)", async () => {
    mockState.findUnique.mockResolvedValue(makeSubscription("TRIAL", PRO_FEATURES));
    const flags = await getFeatureFlags("c1");
    expect(flags).toEqual(PRO_FEATURES);
    expect(mockState.findUnique).toHaveBeenCalledWith({
      where: { clinicId: "c1" },
      include: { plan: true },
    });
  });

  it("ACTIVE → returns plan flags (Pro tier)", async () => {
    mockState.findUnique.mockResolvedValue(makeSubscription("ACTIVE", PRO_FEATURES));
    const flags = await getFeatureFlags("c1");
    expect(flags).toEqual(PRO_FEATURES);
  });

  it("PAST_DUE → returns plan flags (Stripe-style grace period)", async () => {
    mockState.findUnique.mockResolvedValue(
      makeSubscription("PAST_DUE", PRO_FEATURES)
    );
    const flags = await getFeatureFlags("c1");
    // Grace period: still on Pro until Phase 9c billing UI escalates.
    expect(flags).toEqual(PRO_FEATURES);
  });

  it("CANCELLED → returns DEFAULT_FLAGS regardless of plan", async () => {
    mockState.findUnique.mockResolvedValue(
      makeSubscription("CANCELLED", ENTERPRISE_FEATURES)
    );
    const flags = await getFeatureFlags("c1");
    expect(flags).toEqual(DEFAULT_FLAGS);
  });

  it("no subscription → returns DEFAULT_FLAGS", async () => {
    mockState.findUnique.mockResolvedValue(null);
    const flags = await getFeatureFlags("c1");
    expect(flags).toEqual(DEFAULT_FLAGS);
  });

  it("Basic-tier ACTIVE plan parses correctly (all-false / minimum quotas)", async () => {
    mockState.findUnique.mockResolvedValue(
      makeSubscription("ACTIVE", BASIC_FEATURES)
    );
    const flags = await getFeatureFlags("c1");
    expect(flags).toEqual(BASIC_FEATURES);
  });

  it("Enterprise-tier ACTIVE plan parses correctly (all-true / max quotas)", async () => {
    mockState.findUnique.mockResolvedValue(
      makeSubscription("ACTIVE", ENTERPRISE_FEATURES)
    );
    const flags = await getFeatureFlags("c1");
    expect(flags).toEqual(ENTERPRISE_FEATURES);
  });

  it("malformed features (missing keys) → keys fall back to DEFAULT_FLAGS individually", async () => {
    // Only `hasTelegramInbox` set — every other key should default.
    mockState.findUnique.mockResolvedValue(
      makeSubscription("ACTIVE", { hasTelegramInbox: true })
    );
    const flags = await getFeatureFlags("c1");
    expect(flags).toEqual({
      hasTelegramInbox: true,
      hasCallCenter: false,
      hasAnalyticsPro: false,
      maxBranches: 1,
      maxUsers: 5,
    });
  });

  it("malformed features (wrong types) → bad keys ignored, others retained", async () => {
    mockState.findUnique.mockResolvedValue(
      makeSubscription("ACTIVE", {
        hasTelegramInbox: "yes" as unknown as boolean, // string, not boolean
        hasCallCenter: true,
        hasAnalyticsPro: 1 as unknown as boolean, // number, not boolean
        maxBranches: "lots" as unknown as number, // string, not number
        maxUsers: 12,
      })
    );
    const flags = await getFeatureFlags("c1");
    expect(flags).toEqual({
      hasTelegramInbox: false, // bad type → default
      hasCallCenter: true, // good
      hasAnalyticsPro: false, // bad type → default
      maxBranches: 1, // bad type → default
      maxUsers: 12, // good
    });
  });

  it("non-object features (null / array / string) → DEFAULT_FLAGS", async () => {
    for (const bad of [null, [PRO_FEATURES], "{}", 42]) {
      mockState.findUnique.mockResolvedValue(makeSubscription("ACTIVE", bad));
      const flags = await getFeatureFlags("c1");
      expect(flags).toEqual(DEFAULT_FLAGS);
    }
  });

  it("returned flags are a fresh copy — DEFAULT_FLAGS is not aliased", async () => {
    mockState.findUnique.mockResolvedValue(null);
    const a = await getFeatureFlags("c1");
    const b = await getFeatureFlags("c1");
    expect(a).toEqual(DEFAULT_FLAGS);
    expect(b).toEqual(DEFAULT_FLAGS);
    expect(a).not.toBe(DEFAULT_FLAGS); // not the same object
    a.maxBranches = 999;
    expect(DEFAULT_FLAGS.maxBranches).toBe(1); // mutating result didn't leak
  });

  it("findUnique receives the clinicId verbatim (no extra scoping)", async () => {
    mockState.findUnique.mockResolvedValue(null);
    await getFeatureFlags("clinic_abc_123");
    expect(mockState.findUnique).toHaveBeenCalledTimes(1);
    const arg = mockState.findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ clinicId: "clinic_abc_123" });
    expect(arg.include).toEqual({ plan: true });
  });
});

describe("parsePlanFeatures (defensive parser)", () => {
  it("parses a fully-valid Pro shape unchanged", () => {
    expect(parsePlanFeatures(PRO_FEATURES)).toEqual(PRO_FEATURES);
  });

  it("rejects Infinity / NaN integers and falls back to default", () => {
    const flags = parsePlanFeatures({
      ...PRO_FEATURES,
      maxBranches: Infinity,
      maxUsers: NaN,
    });
    expect(flags.maxBranches).toBe(DEFAULT_FLAGS.maxBranches);
    expect(flags.maxUsers).toBe(DEFAULT_FLAGS.maxUsers);
    // boolean keys still come through.
    expect(flags.hasTelegramInbox).toBe(true);
  });

  it("returns DEFAULT_FLAGS for null / undefined / non-object input", () => {
    expect(parsePlanFeatures(null)).toEqual(DEFAULT_FLAGS);
    expect(parsePlanFeatures(undefined)).toEqual(DEFAULT_FLAGS);
    expect(parsePlanFeatures(42)).toEqual(DEFAULT_FLAGS);
    expect(parsePlanFeatures("nope")).toEqual(DEFAULT_FLAGS);
    expect(parsePlanFeatures([])).toEqual(DEFAULT_FLAGS);
  });
});
