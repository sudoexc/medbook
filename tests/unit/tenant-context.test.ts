import { describe, it, expect } from "vitest";

import {
  getClinicId,
  getTenant,
  requireTenant,
  runWithTenant,
  isTenantContext,
  type TenantContext,
} from "@/lib/tenant-context";

describe("tenant-context", () => {
  it("getTenant() returns undefined outside runWithTenant", () => {
    expect(getTenant()).toBeUndefined();
  });

  it("requireTenant() throws 403 outside runWithTenant", () => {
    try {
      requireTenant();
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as Error & { status?: number };
      expect(err.message).toMatch(/TenantContextMissing/);
      expect(err.status).toBe(403);
    }
  });

  it("runWithTenant(TENANT, fn) propagates ctx to nested async calls", async () => {
    const ctx: TenantContext = {
      kind: "TENANT",
      clinicId: "clinic_a",
      userId: "user_1",
      role: "ADMIN",
    };
    const result = await runWithTenant(ctx, async () => {
      await Promise.resolve();
      await Promise.resolve();
      const read = getTenant();
      return { read, clinicId: getClinicId(), inTenant: isTenantContext() };
    });
    expect(result.read).toEqual(ctx);
    expect(result.clinicId).toBe("clinic_a");
    expect(result.inTenant).toBe(true);
  });

  it("runWithTenant(SUPER_ADMIN) leaves clinicId null", async () => {
    await runWithTenant(
      { kind: "SUPER_ADMIN", userId: "root" },
      async () => {
        expect(getTenant()).toEqual({
          kind: "SUPER_ADMIN",
          userId: "root",
        });
        expect(getClinicId()).toBeNull();
        expect(isTenantContext()).toBe(false);
      }
    );
  });

  it("runWithTenant(SYSTEM) returns null clinicId", async () => {
    await runWithTenant({ kind: "SYSTEM" }, async () => {
      expect(getClinicId()).toBeNull();
      expect(isTenantContext()).toBe(false);
    });
  });

  it("contexts are isolated across parallel runs", async () => {
    const readA = runWithTenant(
      {
        kind: "TENANT",
        clinicId: "A",
        userId: "ua",
        role: "ADMIN",
      },
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        return getClinicId();
      }
    );
    const readB = runWithTenant(
      {
        kind: "TENANT",
        clinicId: "B",
        userId: "ub",
        role: "DOCTOR",
      },
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getClinicId();
      }
    );
    const [a, b] = await Promise.all([readA, readB]);
    expect(a).toBe("A");
    expect(b).toBe("B");
  });

  it("leaves no context after runWithTenant resolves", async () => {
    await runWithTenant(
      {
        kind: "TENANT",
        clinicId: "X",
        userId: "u",
        role: "DOCTOR",
      },
      async () => {
        expect(getClinicId()).toBe("X");
      }
    );
    expect(getTenant()).toBeUndefined();
  });
});
