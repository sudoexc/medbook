/**
 * Tests the tenant-scope Prisma extension logic WITHOUT touching Postgres.
 *
 * We reimplement the `query` hook by mocking `PrismaClient.$extends`:
 *   - `$extends({ query: { $allModels: { $allOperations: cb } } })` captures
 *     the callback.
 *   - We invoke `cb` ourselves with synthetic `{ model, operation, args, query }`
 *     payloads and assert that `args` gets mutated as expected.
 *
 * This avoids the need for a live DB while still covering the real code
 * path used by `src/lib/prisma.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock the generated Prisma client & the pg adapter ---------------------
//
// vi.mock factories are hoisted above imports; we use vi.hoisted to share
// a captured-hook holder between the factory and the test body.

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
      query: {
        $allModels: {
          $allOperations: CapturedHook;
        };
      };
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
import { runWithTenant } from "@/lib/tenant-context";

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

describe("prisma tenant-scope extension", () => {
  beforeEach(() => {
    expect(captured.hook).not.toBeNull();
  });

  it("injects clinicId into findMany.where inside TENANT context", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c1", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "Patient",
          operation: "findMany",
          args: { where: { fullName: "John" } },
        });
        await call;
        expect(query).toHaveBeenCalledOnce();
        const passed = query.mock.calls[0][0] as {
          where: { clinicId: string; fullName: string };
        };
        expect(passed.where.clinicId).toBe("c1");
        expect(passed.where.fullName).toBe("John");
      }
    );
  });

  it("injects clinicId into create.data inside TENANT context", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c2", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "Patient",
          operation: "create",
          args: { data: { fullName: "Alice", phone: "+998" } },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          data: { clinicId: string };
        };
        expect(passed.data.clinicId).toBe("c2");
      }
    );
  });

  it("injects clinicId into each row of createMany.data array", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c3", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "Service",
          operation: "createMany",
          args: {
            data: [{ code: "A", priceBase: 1 }, { code: "B", priceBase: 2 }],
          },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          data: Array<{ clinicId: string; code: string }>;
        };
        expect(passed.data.every((r) => r.clinicId === "c3")).toBe(true);
      }
    );
  });

  it("does NOT inject for allowlisted models (User, AuditLog)", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c1", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "User",
          operation: "findUnique",
          args: { where: { email: "a@b.c" } },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: Record<string, unknown>;
        };
        expect("clinicId" in passed.where).toBe(false);
      }
    );

    await runWithTenant(
      { kind: "TENANT", clinicId: "c1", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "AuditLog",
          operation: "create",
          args: { data: { action: "x", entityType: "y" } },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          data: Record<string, unknown>;
        };
        expect("clinicId" in passed.data).toBe(false);
      }
    );
  });

  it("does NOT inject when using a composite unique (Doctor.clinicId_slug)", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c1", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "Doctor",
          operation: "findUnique",
          args: {
            where: { clinicId_slug: { clinicId: "c1", slug: "neuro" } },
          },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: Record<string, unknown>;
        };
        // The composite key is present; we must NOT have added a top-level
        // clinicId alongside it (Prisma would reject the mixed where).
        expect("clinicId" in passed.where).toBe(false);
        expect("clinicId_slug" in passed.where).toBe(true);
      }
    );
  });

  it("SUPER_ADMIN context never injects", async () => {
    await runWithTenant(
      { kind: "SUPER_ADMIN", userId: "root" },
      async () => {
        const { call, query } = runHook({
          model: "Patient",
          operation: "findMany",
          args: { where: { fullName: "Jane" } },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: Record<string, unknown>;
        };
        expect("clinicId" in passed.where).toBe(false);
      }
    );
  });

  it("SYSTEM context never injects", async () => {
    await runWithTenant({ kind: "SYSTEM" }, async () => {
      const { call, query } = runHook({
        model: "Patient",
        operation: "create",
        args: { data: { fullName: "Bob" } },
      });
      await call;
      const passed = query.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect("clinicId" in passed.data).toBe(false);
    });
  });

  it("skipTenantScope bypasses injection for MODELS_TENANT_BYPASSABLE", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c1", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "ExchangeRate",
          operation: "findMany",
          args: { where: { date: new Date() }, skipTenantScope: true },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: Record<string, unknown>;
          skipTenantScope?: boolean;
        };
        expect("clinicId" in passed.where).toBe(false);
        // Flag must be stripped before forwarding to Prisma.
        expect(passed.skipTenantScope).toBeUndefined();
      }
    );
  });

  it("skipTenantScope is ignored on non-bypassable models", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c1", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "Patient",
          operation: "findMany",
          args: { where: {}, skipTenantScope: true },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: { clinicId?: string };
        };
        expect(passed.where.clinicId).toBe("c1");
      }
    );
  });

  it("upsert: injects into where AND create-payload", async () => {
    await runWithTenant(
      { kind: "TENANT", clinicId: "c9", userId: "u", role: "ADMIN" },
      async () => {
        const { call, query } = runHook({
          model: "Patient",
          operation: "upsert",
          args: {
            where: { id: "p1" },
            create: { fullName: "A", phone: "+1" },
            update: { fullName: "A2" },
          },
        });
        await call;
        const passed = query.mock.calls[0][0] as {
          where: { clinicId: string };
          create: { clinicId: string };
        };
        expect(passed.where.clinicId).toBe("c9");
        expect(passed.create.clinicId).toBe("c9");
      }
    );
  });

  it("no ambient context → passes through unmodified", async () => {
    const { call, query } = runHook({
      model: "Patient",
      operation: "findMany",
      args: { where: { fullName: "No-ctx" } },
    });
    await call;
    const passed = query.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect("clinicId" in passed.where).toBe(false);
  });
});
