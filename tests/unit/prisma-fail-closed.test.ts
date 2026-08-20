/**
 * Fail-closed tenant isolation (security-audit fix).
 *
 * Before the fix, the tenant-scope extension silently passed queries through
 * when NO AsyncLocalStorage context was bound — any code path that forgot
 * `runWithTenant` would read/write EVERY clinic's rows (fail-open). These
 * tests pin the new contract:
 *
 *   (a) tenant-scoped model + no context      → MissingTenantContextError;
 *   (b) `runUnscoped(reason, fn)`             → explicit bypass, query runs
 *       unmodified (no clinicId injection);
 *   (c) TENANT context                        → clinicId still auto-injected
 *       exactly as before (no behaviour change for the main path);
 *   (d) non-tenant models (MODELS_WITHOUT_TENANT) stay reachable with no
 *       context — login-time User/Session lookups must keep working.
 *
 * Mirrors the mocking pattern of `tests/unit/prisma-tenant.test.ts`: we
 * capture the `$extends` query hook and invoke it with synthetic payloads.
 * No live database is used.
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

// Import AFTER mocks are registered.
import "@/lib/prisma";
import { MissingTenantContextError } from "@/lib/prisma";
import { runUnscoped, runWithTenant, getTenant } from "@/lib/tenant-context";

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

describe("prisma fail-closed tenant isolation", () => {
  beforeEach(() => {
    expect(captured.hook).not.toBeNull();
  });

  it("(a) tenant-scoped model with NO context throws MissingTenantContextError", async () => {
    const { call, query } = runHook({
      model: "Patient",
      operation: "findMany",
      args: { where: { fullName: "Иван" } },
    });
    await expect(call).rejects.toBeInstanceOf(MissingTenantContextError);
    // The underlying query must never be reached — the row can't leak.
    expect(query).not.toHaveBeenCalled();
  });

  it("(a) error message names the model + operation and both remedies", async () => {
    const { call } = runHook({
      model: "Appointment",
      operation: "deleteMany",
      args: { where: {} },
    });
    // Assert the settled rejection several times — no `s` regex flag, the
    // repo tsconfig targets pre-es2018 for test files.
    await expect(call).rejects.toThrow(/Appointment\.deleteMany/);
    await expect(call).rejects.toThrow(/runWithTenant/);
    await expect(call).rejects.toThrow(/runUnscoped/);
  });

  it("(a) writes are equally rejected (create on a tenant model, no context)", async () => {
    const { call, query } = runHook({
      model: "Payment",
      operation: "create",
      args: { data: { amount: 1 } },
    });
    await expect(call).rejects.toBeInstanceOf(MissingTenantContextError);
    expect(query).not.toHaveBeenCalled();
  });

  it("(a) non-CRUD operations on tenant models are rejected too (no bypass via exotic ops)", async () => {
    const { call, query } = runHook({
      model: "Patient",
      operation: "findRaw",
      args: {},
    });
    await expect(call).rejects.toBeInstanceOf(MissingTenantContextError);
    expect(query).not.toHaveBeenCalled();
  });

  it("(b) runUnscoped allows the same query and forwards args unmodified", async () => {
    await runUnscoped("test: deliberate cross-tenant read", async () => {
      const { call, query } = runHook({
        model: "Patient",
        operation: "findMany",
        args: { where: { fullName: "Иван" } },
      });
      await call;
      expect(query).toHaveBeenCalledOnce();
      const passed = query.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      // Bypass means bypass: no clinicId injection either.
      expect("clinicId" in passed.where).toBe(false);
      expect(passed.where.fullName).toBe("Иван");
    });
  });

  it("(b) runUnscoped binds an UNSCOPED context carrying the reason", async () => {
    await runUnscoped("test: reason is preserved", async () => {
      const ctx = getTenant();
      expect(ctx).toEqual({
        kind: "UNSCOPED",
        reason: "test: reason is preserved",
      });
    });
    // Context must not leak outside the callback.
    expect(getTenant()).toBeUndefined();
  });

  it("(c) TENANT context still auto-injects clinicId into where", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c1", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "Patient",
          operation: "findMany",
          args: { where: { fullName: "Иван" } },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: { clinicId: string; fullName: string };
        };
        expect(passed.where.clinicId).toBe("c1");
        expect(passed.where.fullName).toBe("Иван");
      },
    );
  });

  it("(c) TENANT context still auto-injects clinicId into create.data", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c2", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "Appointment",
          operation: "create",
          args: { data: { patientId: "p1" } },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          data: { clinicId: string };
        };
        expect(passed.data.clinicId).toBe("c2");
      },
    );
  });

  it("(d) non-tenant models (User, Session, Clinic) stay reachable with no context", async () => {
    for (const model of ["User", "Session", "Clinic"]) {
      const { call, query } = runHook({
        model,
        operation: "findFirst",
        args: { where: {} },
      });
      await call;
      expect(query).toHaveBeenCalledOnce();
    }
  });

  it("SYSTEM and SUPER_ADMIN contexts keep working (no injection, no throw)", async () => {
    await runWithTenant({ kind: "SYSTEM" }, async () => {
      const { call, query } = runHook({
        model: "Patient",
        operation: "findMany",
        args: { where: {} },
      });
      await call;
      expect(query).toHaveBeenCalledOnce();
    });
    await runWithTenant({ kind: "SUPER_ADMIN", userId: "root" }, async () => {
      const { call, query } = runHook({
        model: "Payment",
        operation: "updateMany",
        args: { where: {}, data: {} },
      });
      await call;
      expect(query).toHaveBeenCalledOnce();
    });
  });
});
