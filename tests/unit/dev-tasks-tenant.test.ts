/**
 * «Задачи» board: tenant isolation at the Prisma layer.
 *
 * The board's routes never pass a clinicId for reads; they rely on the
 * tenant-scope extension (src/lib/prisma.ts) to pin every DevTask,
 * DevTaskComment and DevTaskAttachment query to the caller's clinic. That
 * only holds while all three models carry their own clinicId and none is
 * listed as exempt. Pinned here against the real extension hook (same
 * harness as prisma-tenant.test.ts), plus the schema facts it depends on.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

type CapturedHook = (payload: {
  model?: string;
  operation: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
}) => Promise<unknown>;

const captured = vi.hoisted(() => ({ hook: null as CapturedHook | null }));

vi.mock("@/generated/prisma/client", () => {
  class MockBasePrismaClient {
    $extends(extension: { query: { $allModels: { $allOperations: CapturedHook } } }) {
      captured.hook = extension.query.$allModels.$allOperations;
      return this;
    }
  }
  return { PrismaClient: MockBasePrismaClient };
});

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));

import "@/lib/prisma";
import { MissingTenantContextError } from "@/lib/prisma";
import { COMPOSITE_TENANT_UNIQUES, MODELS_WITHOUT_TENANT } from "@/lib/tenant-allowlist";
import { runWithTenant } from "@/lib/tenant-context";

const MODELS = ["DevTask", "DevTaskComment", "DevTaskAttachment"] as const;
const TENANT = { kind: "TENANT" as const, clinicId: "c1", userId: "u1", role: "ADMIN" as const };

async function forwarded(model: string, operation: string, args: Record<string, unknown>) {
  const query = vi.fn(async (a: Record<string, unknown>) => a);
  await captured.hook!({ model, operation, args, query });
  return query.mock.calls[0]![0] as Record<string, unknown>;
}

describe("DevTask models under the tenant extension", () => {
  beforeEach(() => {
    expect(captured.hook).not.toBeNull();
  });

  it("all three carry clinicId in the schema and none is exempt from scoping", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    for (const model of MODELS) {
      const body = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1] ?? "";
      expect(body, model).toMatch(/^\s+clinicId\s+String\s*$/m);
      expect(MODELS_WITHOUT_TENANT.has(model), model).toBe(false);
    }
    // The per-clinic number is unique per clinic, and the extension knows
    // that composite already pins the clinic.
    expect(schema).toMatch(/@@unique\(\[clinicId, number\]\)/);
    expect(COMPOSITE_TENANT_UNIQUES.has("DevTask.clinicId_number")).toBe(true);
  });

  it("reads and filter-writes are pinned to the caller's clinic", async () => {
    await runWithTenant(TENANT, async () => {
      for (const model of MODELS) {
        for (const operation of ["findFirst", "findMany", "count", "updateMany", "deleteMany"]) {
          const args = await forwarded(model, operation, { where: { id: "x" } });
          expect((args.where as Record<string, unknown>).clinicId, `${model}.${operation}`).toBe("c1");
        }
      }
      const grouped = await forwarded("DevTask", "groupBy", { by: ["status"] });
      expect((grouped.where as Record<string, unknown>).clinicId).toBe("c1");
    });
  });

  it("a task looked up by its «#12» gets the clinic added, so #12 of another clinic is never found", async () => {
    await runWithTenant(TENANT, async () => {
      const args = await forwarded("DevTask", "findFirst", { where: { number: 12 } });
      expect(args.where).toEqual({ number: 12, clinicId: "c1" });
    });
  });

  it("creates are stamped with the caller's clinic", async () => {
    await runWithTenant(TENANT, async () => {
      for (const model of MODELS) {
        const args = await forwarded(model, "create", { data: { taskId: "t1" } });
        expect((args.data as Record<string, unknown>).clinicId, model).toBe("c1");
      }
    });
  });

  it("without a tenant context the query is refused, not run across clinics", async () => {
    for (const model of MODELS) {
      await expect(
        captured.hook!({
          model,
          operation: "findMany",
          args: {},
          query: async (a) => a,
        }),
      ).rejects.toBeInstanceOf(MissingTenantContextError);
    }
  });
});
