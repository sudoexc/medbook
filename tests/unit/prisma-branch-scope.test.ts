/**
 * Phase 9a — Branch scoping behavior of the Prisma tenant extension.
 *
 * Mirrors the mocking pattern of `tests/unit/prisma-tenant.test.ts`:
 *   - We capture the `$extends` query hook and invoke it with synthetic
 *     payloads, asserting that `args.where` / `args.data` get patched as
 *     expected.
 *   - No live database is used.
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
  PrismaPg: class {
    constructor(_: unknown) {}
  },
}));

import "@/lib/prisma";
import { runWithTenant, getBranchId } from "@/lib/tenant-context";

function runHook(payload: {
  model?: string;
  operation: string;
  args: Record<string, unknown>;
}) {
  if (!captured.hook) throw new Error("extension hook not captured");
  const query = vi.fn(async (a: Record<string, unknown>) => ({
    forwardedArgs: a,
  }));
  return {
    call: captured.hook({ ...payload, query }),
    query,
  };
}

describe("prisma branch-scope extension (Phase 9a)", () => {
  beforeEach(() => {
    expect(captured.hook).not.toBeNull();
  });

  it("TENANT context without branchId leaves branchId untouched on Doctor.findMany (clinic-wide)", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c1", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "Doctor",
          operation: "findMany",
          args: { where: { isActive: true } },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: { clinicId: string; branchId?: string; isActive: boolean };
        };
        expect(passed.where.clinicId).toBe("c1");
        expect("branchId" in passed.where).toBe(false);
        expect(passed.where.isActive).toBe(true);
      }
    );
  });

  it("TENANT context WITH branchId pins branchId on Doctor.findMany", async () => {
    await runWithTenant(
      {
        kind: "TENANT",
        clinicId: "c1",
        userId: "u",
        role: "ADMIN",
        branchId: "br_hq",
      },
      async () => {
        const { call, query } = runHook({
          model: "Doctor",
          operation: "findMany",
          args: { where: { isActive: true } },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: { clinicId: string; branchId: string; isActive: boolean };
        };
        expect(passed.where.clinicId).toBe("c1");
        expect(passed.where.branchId).toBe("br_hq");
        expect(passed.where.isActive).toBe(true);
      }
    );
  });

  it("TENANT context WITH branchId does NOT pin branchId on Patient (clinic-wide model)", async () => {
    await runWithTenant(
      {
        kind: "TENANT",
        clinicId: "c1",
        userId: "u",
        role: "ADMIN",
        branchId: "br_hq",
      },
      async () => {
        const { call, query } = runHook({
          model: "Patient",
          operation: "findMany",
          args: { where: { fullName: "Иван" } },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: { clinicId: string; branchId?: string; fullName: string };
        };
        expect(passed.where.clinicId).toBe("c1");
        expect("branchId" in passed.where).toBe(false);
        expect(passed.where.fullName).toBe("Иван");
      }
    );
  });

  it("TENANT context WITH branchId injects branchId on Appointment.create.data", async () => {
    await runWithTenant(
      {
        kind: "TENANT",
        clinicId: "c1",
        userId: "u",
        role: "ADMIN",
        branchId: "br_hq",
      },
      async () => {
        const { call, query } = runHook({
          model: "Appointment",
          operation: "create",
          args: { data: { patientId: "p1", doctorId: "d1" } },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          data: { clinicId: string; branchId: string };
        };
        expect(passed.data.clinicId).toBe("c1");
        expect(passed.data.branchId).toBe("br_hq");
      }
    );
  });

  it("TENANT context WITH branchId still pins branchId when where uses composite clinicId_slug (Doctor)", async () => {
    await runWithTenant(
      {
        kind: "TENANT",
        clinicId: "c1",
        userId: "u",
        role: "ADMIN",
        branchId: "br_hq",
      },
      async () => {
        const { call, query } = runHook({
          model: "Doctor",
          operation: "findUnique",
          args: {
            where: { clinicId_slug: { clinicId: "c1", slug: "neurologist" } },
          },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: { clinicId_slug: unknown; clinicId?: string; branchId: string };
        };
        // Composite stays intact, no top-level clinicId duplication, but
        // branchId is layered on so we don't read across branches.
        expect("clinicId" in passed.where).toBe(false);
        expect("clinicId_slug" in passed.where).toBe(true);
        expect(passed.where.branchId).toBe("br_hq");
      }
    );
  });

  it("getBranchId() returns null when ctx has no branchId, the value when set", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c1", userId: "u", role: "ADMIN" },
      async () => {
        expect(getBranchId()).toBeNull();
      }
    );
    await runWithTenant(
      {
        kind: "TENANT",
        clinicId: "c1",
        userId: "u",
        role: "ADMIN",
        branchId: "br_hq",
      },
      async () => {
        expect(getBranchId()).toBe("br_hq");
      }
    );
    await runWithTenant({ kind: "SUPER_ADMIN", userId: "root" }, async () => {
      expect(getBranchId()).toBeNull();
    });
  });

  it("explicit branchId in user data overrides ambient branchId injection", async () => {
    await runWithTenant(
      {
        kind: "TENANT",
        clinicId: "c1",
        userId: "u",
        role: "ADMIN",
        branchId: "br_hq",
      },
      async () => {
        const { call, query } = runHook({
          model: "Doctor",
          operation: "create",
          args: {
            data: { slug: "x", branchId: "br_other" },
          },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          data: { branchId: string; clinicId: string };
        };
        expect(passed.data.branchId).toBe("br_other");
        expect(passed.data.clinicId).toBe("c1");
      }
    );
  });
});
