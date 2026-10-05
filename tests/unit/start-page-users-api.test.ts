/**
 * PATCH /api/crm/users/[id] and the «Стартовая страница» select (owner
 * request 05.10.2026): an ADMIN sets or clears the tablet start page on a
 * reception account; any other role is refused; leaving the reception role
 * clears it; open sessions follow on their next request.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  userUpdates: [] as Array<Record<string, unknown>>,
  invalidate: vi.fn(),
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "admin1", role: "ADMIN" };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) => {
        // The real wrapper answers 400 on a body the schema refuses.
        const parsed = opts.bodySchema?.safeParse(await request.json());
        if (parsed && !parsed.success) {
          return new Response(JSON.stringify({ error: "validation" }), { status: 400 });
        }
        return handler({ request, body: parsed?.data, ctx });
      },
    createApiListHandler: () => async () => new Response(null),
  };
});
vi.mock("@/lib/prisma", () => {
  const tx = {
    user: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.userUpdates.push(data);
        return { ...h.user, ...data };
      }),
    },
    doctor: { updateMany: vi.fn(async () => ({ count: 0 })), update: vi.fn(async () => ({})) },
  };
  return {
    prisma: {
      user: {
        findFirst: vi.fn(async () => h.user),
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 1),
      },
      doctor: { findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/auth/session-guard", () => ({
  revokeUserSessions: vi.fn(async () => 0),
  invalidateSessionGuardCache: h.invalidate,
}));

import { PATCH } from "@/app/api/crm/users/[id]/route";

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request("https://x/api/crm/users/ipad1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  h.user = {
    id: "ipad1",
    clinicId: "c1",
    role: "RECEPTIONIST",
    active: true,
    email: "reception-ipad@neurofax.uz",
    startPage: null,
  };
  h.userUpdates = [];
  h.invalidate.mockClear();
});

describe("PATCH /api/crm/users/[id] startPage", () => {
  it("sets the tablet start page on a reception account, and open sessions re-read it", async () => {
    const r = await patch({ startPage: "reception-tablet" });
    expect(r.status).toBe(200);
    expect(h.userUpdates[0]).toMatchObject({ startPage: "reception-tablet" });
    expect(h.invalidate).toHaveBeenCalledWith("ipad1");
    const body = (await r.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
    expect(JSON.stringify(body)).toContain('"startPage":"reception-tablet"');
  });

  it("clears it with null", async () => {
    h.user!.startPage = "reception-tablet";
    const r = await patch({ startPage: null });
    expect(r.status).toBe(200);
    expect(h.userUpdates[0]).toMatchObject({ startPage: null });
  });

  it("refuses it for another role, before writing anything", async () => {
    h.user!.role = "ADMIN";
    const r = await patch({ startPage: "reception-tablet" });
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).toContain("start_page_not_allowed");
    expect(h.userUpdates).toHaveLength(0);
  });

  it("judges by the role after the edit", async () => {
    const promote = await patch({ role: "NURSE", startPage: "reception-tablet" });
    expect(promote.status).toBe(422);
    expect(h.userUpdates).toHaveLength(0);

    h.user!.role = "NURSE";
    const toReception = await patch({ role: "RECEPTIONIST", startPage: "reception-tablet" });
    expect(toReception.status).toBe(200);
    expect(h.userUpdates[0]).toMatchObject({ role: "RECEPTIONIST", startPage: "reception-tablet" });
  });

  it("an account leaving the reception role loses its start page", async () => {
    h.user!.startPage = "reception-tablet";
    const r = await patch({ role: "CALL_OPERATOR" });
    expect(r.status).toBe(200);
    expect(h.userUpdates[0]).toMatchObject({ role: "CALL_OPERATOR", startPage: null });
  });

  it("an edit that does not mention it leaves it untouched", async () => {
    h.user!.startPage = "reception-tablet";
    const r = await patch({ name: "iPad ресепшн" });
    expect(r.status).toBe(200);
    expect(h.userUpdates[0]).not.toHaveProperty("startPage");
  });

  it("an unknown value is a 400, not a write", async () => {
    const r = await patch({ startPage: "admin-dashboard" });
    expect(r.status).toBe(400);
    expect(h.userUpdates).toHaveLength(0);
  });
});
