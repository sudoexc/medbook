/**
 * SEC-11: the tenant-scope extension used to pass any operation it did not
 * recognise straight through to Postgres, unscoped. Prisma 7 added
 * `updateManyAndReturn`, which was missing from the filter-mutate set, so a
 * TENANT-context call would have updated every clinic's rows.
 *
 * Contract pinned here:
 *   - updateManyAndReturn under TENANT gets clinicId (and branchId for
 *     branch-scoped models) injected into `where`;
 *   - any operation outside the known sets on a tenant-scoped model under
 *     TENANT throws UnsupportedTenantOperationError before the query runs;
 *   - non-tenant models and the SYSTEM / runUnscoped bypasses are unchanged.
 *
 * Same mocking pattern as tests/unit/prisma-tenant.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type CapturedHook = (payload: {
  model?: string;
  operation: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
}) => Promise<unknown>;

const captured = vi.hoisted(() => ({ hook: null as CapturedHook | null }));

vi.mock("@/generated/prisma/client", () => {
  class MockBasePrismaClient {
    $extends(extension: {
      query: { $allModels: { $allOperations: CapturedHook } };
    }) {
      captured.hook = extension.query.$allModels.$allOperations;
      return this;
    }
  }
  return { PrismaClient: MockBasePrismaClient };
});

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {},
}));

import "@/lib/prisma";
import { UnsupportedTenantOperationError } from "@/lib/prisma";
import { runUnscoped, runWithTenant } from "@/lib/tenant-context";
import { MUTATE_BY_WHERE_OPERATIONS } from "@/lib/tenant-allowlist";

function runHook(payload: {
  model?: string;
  operation: string;
  args: Record<string, unknown>;
}) {
  if (!captured.hook) throw new Error("extension hook not captured");
  const query = vi.fn(async (a: Record<string, unknown>) => ({
    forwardedArgs: a,
  }));
  return { call: captured.hook({ ...payload, query }), query };
}

const TENANT = {
  kind: "TENANT" as const,
  clinicId: "c1",
  userId: "u",
  role: "ADMIN" as const,
};

describe("SEC-11 tenant extension: unknown operations fail closed", () => {
  beforeEach(() => {
    expect(captured.hook).not.toBeNull();
  });

  it("updateManyAndReturn is a filter-mutate operation", () => {
    expect(MUTATE_BY_WHERE_OPERATIONS.has("updateManyAndReturn")).toBe(true);
  });

  it("updateManyAndReturn gets clinicId injected into where", async () => {
    await runWithTenant(TENANT, async () => {
      const { call, query } = runHook({
        model: "Appointment",
        operation: "updateManyAndReturn",
        args: { where: { status: "BOOKED" }, data: { status: "CONFIRMED" } },
      });
      await call;
      const passed = query.mock.calls[0][0] as {
        where: { clinicId: string; status: string };
        data: Record<string, unknown>;
      };
      expect(passed.where.clinicId).toBe("c1");
      expect(passed.where.status).toBe("BOOKED");
      // `data` is a patch, never a place to inject the tenant.
      expect("clinicId" in passed.data).toBe(false);
    });
  });

  it("updateManyAndReturn also pins branchId on branch-scoped models", async () => {
    await runWithTenant({ ...TENANT, branchId: "b1" }, async () => {
      const { call, query } = runHook({
        model: "Appointment",
        operation: "updateManyAndReturn",
        args: { where: {}, data: {} },
      });
      await call;
      const passed = query.mock.calls[0][0] as {
        where: { clinicId: string; branchId: string };
      };
      expect(passed.where).toMatchObject({ clinicId: "c1", branchId: "b1" });
    });
  });

  it("an unknown operation on a tenant model under TENANT throws", async () => {
    await runWithTenant(TENANT, async () => {
      const { call, query } = runHook({
        model: "Patient",
        operation: "findRaw",
        args: {},
      });
      await expect(call).rejects.toBeInstanceOf(UnsupportedTenantOperationError);
      await expect(call).rejects.toThrow(/Patient\.findRaw/);
      expect(query).not.toHaveBeenCalled();
    });
  });

  it("a hypothetical future operation is refused too", async () => {
    await runWithTenant(TENANT, async () => {
      const { call, query } = runHook({
        model: "Appointment",
        operation: "deleteManyAndReturn",
        args: { where: {} },
      });
      await expect(call).rejects.toBeInstanceOf(UnsupportedTenantOperationError);
      expect(query).not.toHaveBeenCalled();
    });
  });

  it("non-tenant models still pass any operation through under TENANT", async () => {
    await runWithTenant(TENANT, async () => {
      const { call, query } = runHook({
        model: "User",
        operation: "findRaw",
        args: {},
      });
      await call;
      expect(query).toHaveBeenCalledOnce();
    });
  });

  it("SYSTEM and runUnscoped contexts are not affected", async () => {
    await runWithTenant({ kind: "SYSTEM" }, async () => {
      const { call, query } = runHook({
        model: "Patient",
        operation: "findRaw",
        args: {},
      });
      await call;
      expect(query).toHaveBeenCalledOnce();
    });
    await runUnscoped("SEC-11 test", async () => {
      const { call, query } = runHook({
        model: "Patient",
        operation: "findRaw",
        args: {},
      });
      await call;
      expect(query).toHaveBeenCalledOnce();
    });
  });
});
