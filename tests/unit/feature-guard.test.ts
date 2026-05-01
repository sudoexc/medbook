/**
 * Phase 9d — `ensureFeature` route-level guard.
 *
 * DB-less. Mocks `@/lib/feature-flags.getFeatureFlags` so the test runs
 * without a Postgres connection. Asserts that:
 *
 *   1. TENANT with the flag on → null (request proceeds)
 *   2. TENANT with the flag off → 404 Response (no body leak)
 *   3. SUPER_ADMIN context → null (platform users bypass plan gates)
 *   4. SYSTEM context → null (cron / workers bypass plan gates)
 *
 * The 404 status (not 403) is load-bearing: it matches the "feature
 * dark-launch" convention so basic-tier admins can't enumerate the
 * pro-feature surface.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  getFeatureFlags: vi.fn(),
}));

vi.mock("@/lib/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feature-flags")>(
    "@/lib/feature-flags"
  );
  return {
    ...actual,
    getFeatureFlags: mockState.getFeatureFlags,
  };
});

import { ensureFeature } from "@/server/platform/feature-guard";
import type { TenantContext } from "@/lib/tenant-context";

const TENANT: TenantContext = {
  kind: "TENANT",
  clinicId: "c1",
  userId: "u1",
  role: "ADMIN",
};
const SUPER: TenantContext = { kind: "SUPER_ADMIN", userId: "u_root" };
const SYSTEM: TenantContext = { kind: "SYSTEM" };

const PRO_FLAGS = {
  hasTelegramInbox: true,
  hasCallCenter: true,
  hasAnalyticsPro: false,
  maxBranches: 3,
  maxUsers: 20,
};
const BASIC_FLAGS = {
  hasTelegramInbox: false,
  hasCallCenter: false,
  hasAnalyticsPro: false,
  maxBranches: 1,
  maxUsers: 5,
};

describe("ensureFeature", () => {
  beforeEach(() => {
    mockState.getFeatureFlags.mockReset();
  });

  it("TENANT with flag on → null (proceed)", async () => {
    mockState.getFeatureFlags.mockResolvedValue(PRO_FLAGS);
    const block = await ensureFeature(TENANT, "hasCallCenter");
    expect(block).toBeNull();
    expect(mockState.getFeatureFlags).toHaveBeenCalledWith("c1");
  });

  it("TENANT with flag off → 404 Response", async () => {
    mockState.getFeatureFlags.mockResolvedValue(BASIC_FLAGS);
    const block = await ensureFeature(TENANT, "hasCallCenter");
    expect(block).not.toBeNull();
    expect(block!.status).toBe(404);
    const body = await block!.json();
    expect(body).toEqual({ error: "NotFound" });
  });

  it("TENANT with hasTelegramInbox off → 404", async () => {
    mockState.getFeatureFlags.mockResolvedValue(BASIC_FLAGS);
    const block = await ensureFeature(TENANT, "hasTelegramInbox");
    expect(block?.status).toBe(404);
  });

  it("TENANT with hasAnalyticsPro off → 404 (Pro tier still blocks funnels)", async () => {
    mockState.getFeatureFlags.mockResolvedValue(PRO_FLAGS); // Pro lacks analyticsPro
    const block = await ensureFeature(TENANT, "hasAnalyticsPro");
    expect(block?.status).toBe(404);
  });

  it("SUPER_ADMIN bypasses the gate without a DB call", async () => {
    const block = await ensureFeature(SUPER, "hasCallCenter");
    expect(block).toBeNull();
    expect(mockState.getFeatureFlags).not.toHaveBeenCalled();
  });

  it("SYSTEM bypasses the gate without a DB call", async () => {
    const block = await ensureFeature(SYSTEM, "hasTelegramInbox");
    expect(block).toBeNull();
    expect(mockState.getFeatureFlags).not.toHaveBeenCalled();
  });

  it("404 body does not echo the requested feature key (no leak)", async () => {
    mockState.getFeatureFlags.mockResolvedValue(BASIC_FLAGS);
    const block = await ensureFeature(TENANT, "hasCallCenter");
    const body = (await block!.json()) as Record<string, unknown>;
    // The body intentionally omits the feature key — a basic-tier admin
    // should not be able to differentiate a missing route from a gated one.
    expect(JSON.stringify(body)).not.toContain("CallCenter");
    expect(JSON.stringify(body)).not.toContain("hasCallCenter");
  });
});
