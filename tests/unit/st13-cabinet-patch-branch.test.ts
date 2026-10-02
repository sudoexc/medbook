/**
 * Audit ST-13: editing a cabinet.
 *
 *   - "is a doctor sitting here" is asked clinic-wide: with a branch
 *     selected, a doctor of another branch (or of none) used to be filtered
 *     out, and his cabinet could be switched off under him;
 *   - a branch in the body is checked like on create (this clinic's, still
 *     active) instead of being written as is;
 *   - a cabinet with a doctor in it does not move to another branch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  cabinet: null as null | Record<string, unknown>,
  /** The doctor bound to the cabinet; his branch is not the selected one. */
  occupant: null as null | { id: string; nameRu: string },
  branches: {} as Record<string, { id: string; isActive: boolean }>,
  updates: [] as Array<Record<string, unknown>>,
  occupantLookupScopes: [] as Array<string | null>,
}));

vi.mock("@/lib/api-handler", async () => {
  const { runWithTenant } = await import("@/lib/tenant-context");
  // An admin working "in" branch b1, as the active-branch cookie sets it.
  const ctx = {
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "admin1",
    role: "ADMIN" as const,
    branchId: "b1",
  };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) => {
        const body =
          opts.bodySchema && request.method !== "DELETE"
            ? opts.bodySchema.parse(await request.json())
            : undefined;
        return runWithTenant(ctx, () => handler({ request, body, ctx }));
      },
    createApiListHandler: () => async () => new Response(null),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/prisma", async () => {
  const { getBranchId } = await import("@/lib/tenant-context");
  return {
    prisma: {
      cabinet: {
        findUnique: vi.fn(async () => h.cabinet),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          h.updates.push(data);
          return { ...h.cabinet, ...data };
        }),
      },
      doctor: {
        // Mirrors the tenant extension: a branch in the context filters the
        // lookup, and the occupant belongs to no branch.
        findUnique: vi.fn(async () => {
          const scope = getBranchId();
          h.occupantLookupScopes.push(scope);
          return scope ? null : h.occupant;
        }),
      },
      branch: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) => h.branches[where.id] ?? null,
        ),
      },
    },
  };
});

import { DELETE, PATCH } from "@/app/api/crm/cabinets/[id]/route";

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request("https://x/api/crm/cabinets/cab1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  h.cabinet = { id: "cab1", number: "101", isActive: true, branchId: "b1" };
  h.occupant = { id: "doc1", nameRu: "Султанов Азиз" };
  h.branches = {
    b1: { id: "b1", isActive: true },
    b2: { id: "b2", isActive: true },
    off: { id: "off", isActive: false },
  };
  h.updates = [];
  h.occupantLookupScopes = [];
});

describe("PATCH /api/crm/cabinets/[id]", () => {
  it("refuses to switch off a cabinet whose doctor is in another branch", async () => {
    const res = await patch({ isActive: false });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "cabinet_occupied", doctorId: "doc1" });
    expect(h.occupantLookupScopes).toEqual([null]);
    expect(h.updates).toEqual([]);
  });

  it("switches off a free cabinet", async () => {
    h.occupant = null;
    const res = await patch({ isActive: false });
    expect(res.status).toBe(200);
    expect(h.updates).toEqual([{ isActive: false }]);
  });

  it("refuses a branch that does not exist here or is switched off", async () => {
    h.occupant = null;
    const missing = await patch({ branchId: "elsewhere" });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ reason: "branch_not_found" });
    const inactive = await patch({ branchId: "off" });
    expect(inactive.status).toBe(422);
    expect(await inactive.json()).toMatchObject({ reason: "branch_inactive" });
    const none = await patch({ branchId: null });
    expect(none.status).toBe(422);
    expect(await none.json()).toMatchObject({ reason: "branch_required" });
    expect(h.updates).toEqual([]);
  });

  it("moves a free cabinet to another active branch", async () => {
    h.occupant = null;
    const res = await patch({ branchId: "b2", floor: 2 });
    expect(res.status).toBe(200);
    expect(h.updates).toEqual([{ floor: 2, branchId: "b2" }]);
  });

  it("does not move a cabinet with a doctor in it", async () => {
    const res = await patch({ branchId: "b2" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "cabinet_occupied" });
    expect(h.updates).toEqual([]);
  });

  it("leaves the branch alone when the body repeats the current one", async () => {
    const res = await patch({ branchId: "b1", nameRu: "Неврология" });
    expect(res.status).toBe(200);
    expect(h.updates).toEqual([{ nameRu: "Неврология" }]);
    expect(h.occupantLookupScopes).toEqual([]);
  });
});

describe("DELETE /api/crm/cabinets/[id]", () => {
  it("sees the occupant whatever branch is selected", async () => {
    const res = await DELETE(
      new Request("https://x/api/crm/cabinets/cab1", { method: "DELETE" }),
    );
    expect(res.status).toBe(409);
    expect(h.occupantLookupScopes).toEqual([null]);
    expect(h.updates).toEqual([]);
  });
});
