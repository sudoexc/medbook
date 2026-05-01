/**
 * Phase 9c — `resolveEffectiveBranchId` resolution order.
 *
 * Verifies the documented precedence for create operations:
 *   1. Explicit `bodyOverride` (validated against the active clinic)
 *   2. `ctx.branchId` from the cookie
 *   3. The clinic's default branch (`isDefault=true`, `isActive=true`)
 *   4. `null` (column stays nullable)
 *
 * Cross-clinic body overrides are rejected because the Prisma extension
 * scopes `findUnique` by clinicId — a stranger's branchId surfaces as
 * `null`, which the helper translates into a 422 with `branch_not_found`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  findUnique: vi.fn() as ReturnType<typeof vi.fn>,
  findFirst: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    branch: {
      findUnique: mockState.findUnique,
      findFirst: mockState.findFirst,
    },
  },
}));

import { resolveEffectiveBranchId } from "@/server/branches/resolve-branch";
import type { TenantContext } from "@/lib/tenant-context";

const TENANT: TenantContext = {
  kind: "TENANT",
  clinicId: "clinic_a",
  userId: "u_1",
  role: "ADMIN",
};

beforeEach(() => {
  mockState.findUnique.mockReset();
  mockState.findFirst.mockReset();
});

describe("resolveEffectiveBranchId", () => {
  it("returns null for non-TENANT contexts", async () => {
    const id = await resolveEffectiveBranchId({ kind: "SYSTEM" });
    expect(id).toBeNull();
    expect(mockState.findUnique).not.toHaveBeenCalled();
  });

  it("uses an explicit bodyOverride when valid + active", async () => {
    mockState.findUnique.mockResolvedValueOnce({
      id: "br_explicit",
      isActive: true,
    });
    const id = await resolveEffectiveBranchId(TENANT, "br_explicit");
    expect(id).toBe("br_explicit");
    // No fallback to findFirst when override resolves.
    expect(mockState.findFirst).not.toHaveBeenCalled();
  });

  it("rejects bodyOverride that returns null (cross-clinic / unknown)", async () => {
    mockState.findUnique.mockResolvedValueOnce(null);
    await expect(
      resolveEffectiveBranchId(TENANT, "br_other_clinic"),
    ).rejects.toMatchObject({
      message: "BranchNotFound",
      status: 422,
      reason: "branch_not_found",
    });
  });

  it("rejects bodyOverride pointing to an inactive branch", async () => {
    mockState.findUnique.mockResolvedValueOnce({
      id: "br_x",
      isActive: false,
    });
    await expect(
      resolveEffectiveBranchId(TENANT, "br_x"),
    ).rejects.toMatchObject({
      message: "BranchInactive",
      status: 422,
      reason: "branch_inactive",
    });
  });

  it("uses ctx.branchId when no override is given", async () => {
    const ctxWithBranch: TenantContext = { ...TENANT, branchId: "br_cookie" };
    const id = await resolveEffectiveBranchId(ctxWithBranch);
    expect(id).toBe("br_cookie");
    expect(mockState.findUnique).not.toHaveBeenCalled();
    expect(mockState.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the clinic default when no override + no cookie", async () => {
    mockState.findFirst.mockResolvedValueOnce({ id: "br_default" });
    const id = await resolveEffectiveBranchId(TENANT);
    expect(id).toBe("br_default");
    expect(mockState.findFirst).toHaveBeenCalledTimes(1);
    expect(mockState.findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { isDefault: true, isActive: true },
    });
  });

  it("returns null when nothing resolves (no override, no cookie, no default)", async () => {
    mockState.findFirst.mockResolvedValueOnce(null);
    const id = await resolveEffectiveBranchId(TENANT);
    expect(id).toBeNull();
  });
});
