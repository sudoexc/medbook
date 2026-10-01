/**
 * Audit ST-06: switching a branch off.
 *
 *   - the default branch cannot be switched off (or lose the flag) without
 *     a new default, and a switched-off branch cannot become the default;
 *   - switching off a branch that still has doctors, cabinets or upcoming
 *     visits needs a confirmation that saw the counts;
 *   - the active-branch cookie is checked on every request: a switched-off
 *     or foreign branch is ignored (clinic-wide), not an empty screen;
 *   - sign-in and sign-out clear the cookie.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  branch: null as null | Record<string, unknown>,
  otherActive: 1,
  usage: { doctors: 0, cabinets: 0, appointments: 0 },
  updates: [] as Array<Record<string, unknown>>,
  liveRow: null as null | { id: string },
  liveLookups: 0,
  countCtx: [] as unknown[],
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = {
    kind: "TENANT",
    clinicId: "c1",
    userId: "u1",
    role: "ADMIN",
    branchId: "b-other",
  };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx,
        }),
    createApiListHandler: () => async () => new Response(null),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(c: unknown, fn: () => T) => {
    h.countCtx.push(c);
    return fn();
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    branch: {
      findUnique: vi.fn(async () => h.branch),
      count: vi.fn(async () => h.otherActive),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.updates.push(data);
        return { ...h.branch, ...data };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async () => {
        h.liveLookups += 1;
        return h.liveRow;
      }),
    },
    doctor: { count: vi.fn(async () => h.usage.doctors) },
    cabinet: { count: vi.fn(async () => h.usage.cabinets) },
    appointment: { count: vi.fn(async () => h.usage.appointments) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        branch: {
          updateMany: vi.fn(async () => ({ count: 0 })),
          update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            h.updates.push(data);
            return { ...h.branch, ...data };
          }),
        },
      }),
    ),
  },
}));

import { branchChangeRefusal } from "@/server/branches/branch-rules";
import {
  forgetLiveBranch,
  liveBranchIdOrNull,
  withLiveBranch,
} from "@/server/branches/active-branch-guard";
import {
  ACTIVE_BRANCH_COOKIE_NAME,
  activeBranchClearCookie,
} from "@/server/platform/branch-cookie";
import { DELETE, PATCH } from "@/app/api/crm/branches/[id]/route";

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request("https://x/api/crm/branches/b1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  h.branch = { id: "b1", clinicId: "c1", isActive: true, isDefault: false, nameRu: "Филиал 2" };
  h.otherActive = 1;
  h.usage = { doctors: 0, cabinets: 0, appointments: 0 };
  h.updates = [];
  h.liveRow = null;
  h.liveLookups = 0;
  h.countCtx = [];
  forgetLiveBranch();
});

describe("branchChangeRefusal", () => {
  const plain = { isActive: true, isDefault: false };
  const main = { isActive: true, isDefault: true };
  it("names the rule an edit would break", () => {
    expect(branchChangeRefusal({ before: plain, patch: { isActive: false }, otherActiveCount: 0 })).toBe(
      "last_active_branch",
    );
    expect(branchChangeRefusal({ before: main, patch: { isActive: false }, otherActiveCount: 2 })).toBe(
      "default_branch",
    );
    expect(branchChangeRefusal({ before: main, patch: { isDefault: false }, otherActiveCount: 2 })).toBe(
      "default_branch",
    );
    expect(
      branchChangeRefusal({
        before: { isActive: false, isDefault: false },
        patch: { isDefault: true },
        otherActiveCount: 2,
      }),
    ).toBe("inactive_default");
    expect(branchChangeRefusal({ before: plain, patch: { isActive: false }, otherActiveCount: 1 })).toBeNull();
    expect(branchChangeRefusal({ before: plain, patch: { nameRu: "x" } as never, otherActiveCount: 1 })).toBeNull();
  });
});

describe("PATCH /api/crm/branches/[id]", () => {
  it("the default branch cannot be switched off", async () => {
    h.branch = { ...h.branch, isDefault: true };
    const res = await patch({ isActive: false });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "default_branch" });
    expect(h.updates).toHaveLength(0);
  });

  it("a branch still in use asks for confirmation with the counts", async () => {
    h.usage = { doctors: 2, cabinets: 1, appointments: 5 };
    const res = await patch({ isActive: false });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      reason: "branch_in_use",
      usage: { doctors: 2, cabinets: 1, upcomingAppointments: 5 },
    });
    expect(h.updates).toHaveLength(0);
    // Counted clinic-wide, not inside the admin's own selected branch.
    expect(h.countCtx.at(-1)).not.toHaveProperty("branchId");
  });

  it("the confirmation goes through and is not written as a column", async () => {
    h.usage = { doctors: 2, cabinets: 1, appointments: 5 };
    const res = await patch({ isActive: false, confirmInUse: true });
    expect(res.status).toBe(200);
    expect(h.updates[0]).toEqual({ isActive: false });
  });

  it("an unused branch switches off at once", async () => {
    const res = await patch({ isActive: false });
    expect(res.status).toBe(200);
    expect(h.updates[0]).toEqual({ isActive: false });
  });
});

describe("DELETE /api/crm/branches/[id]", () => {
  it("follows the same rules, confirmation via ?confirm=1", async () => {
    h.usage = { doctors: 1, cabinets: 0, appointments: 0 };
    const first = await DELETE(new Request("https://x/api/crm/branches/b1", { method: "DELETE" }));
    expect(first.status).toBe(409);
    const confirmed = await DELETE(
      new Request("https://x/api/crm/branches/b1?confirm=1", { method: "DELETE" }),
    );
    expect(confirmed.status).toBe(200);
    expect(h.updates[0]).toEqual({ isActive: false });

    h.branch = { ...h.branch, isDefault: true };
    const main = await DELETE(new Request("https://x/api/crm/branches/b1?confirm=1", { method: "DELETE" }));
    expect(main.status).toBe(422);
  });
});

describe("active-branch cookie guard", () => {
  it("a switched-off or foreign branch is dropped from the request scope", async () => {
    h.liveRow = null;
    const ctx = await withLiveBranch({
      kind: "TENANT",
      clinicId: "c1",
      userId: "u1",
      role: "RECEPTIONIST",
      branchId: "b-gone",
    });
    expect(ctx).not.toHaveProperty("branchId");
    expect(ctx).toMatchObject({ kind: "TENANT", clinicId: "c1" });
  });

  it("a live branch stays, and the answer is cached until a branch changes", async () => {
    h.liveRow = { id: "b1" };
    expect(await liveBranchIdOrNull("c1", "b1")).toBe("b1");
    expect(await liveBranchIdOrNull("c1", "b1")).toBe("b1");
    expect(h.liveLookups).toBe(1);
    forgetLiveBranch("b1");
    h.liveRow = null;
    expect(await liveBranchIdOrNull("c1", "b1")).toBeNull();
    expect(h.liveLookups).toBe(2);
  });

  it("no branch in the context, no lookup", async () => {
    const ctx = { kind: "TENANT" as const, clinicId: "c1", userId: "u1", role: "ADMIN" as const };
    expect(await withLiveBranch(ctx)).toBe(ctx);
    expect(h.liveLookups).toBe(0);
  });

  it("sign-in and sign-out delete the cookie", () => {
    expect(activeBranchClearCookie({ secure: true })).toMatchObject({
      name: ACTIVE_BRANCH_COOKIE_NAME,
      value: "",
      path: "/",
      maxAge: 0,
      httpOnly: true,
      secure: true,
    });
  });
});
