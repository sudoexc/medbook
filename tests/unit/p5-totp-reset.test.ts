/**
 * Audit ST-03: an ADMIN can reset a colleague's 2FA (lost phone), with
 * their own password re-entered, every session of the user ended and an
 * audit row; the platform owner can do the same for a clinic's only admin.
 * The users list shows the 2FA status but never the TOTP material.
 */
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  admin: { id: "admin1", passwordHash: "" },
  target: null as null | Record<string, unknown>,
  targetWhere: null as unknown,
  updates: [] as Array<{ where: unknown; data: Record<string, unknown> }>,
  audited: [] as Array<Record<string, unknown>>,
  platformAudited: [] as Array<Record<string, unknown>>,
  revoke: vi.fn(async () => 3),
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
        const parsed = opts.bodySchema!.safeParse(await request.json());
        if (!parsed.success) return Response.json({ error: "ValidationError" }, { status: 400 });
        return handler({ request, body: parsed.data, ctx });
      },
    createApiListHandler: () => async () => new Response(null),
  };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async ({ where }: { where: unknown }) => {
        h.targetWhere = where;
        return h.target;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === h.admin.id ? h.admin : h.target,
      ),
      update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        h.updates.push(args);
        return { ...h.target, ...args.data };
      }),
    },
    clinic: { findUnique: vi.fn(async () => ({ id: "c1" })) },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => fn(),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: Request, input: Record<string, unknown>) => {
    h.audited.push(input);
  }),
}));
vi.mock("@/server/auth/session-guard", () => ({
  revokeUserSessions: h.revoke,
  invalidateSessionGuardCache: vi.fn(),
}));
vi.mock("@/server/platform/handler", () => ({
  requireSuperAdmin: vi.fn(async () => ({ ok: true, userId: "sa1" })),
  platformAudit: vi.fn(async (input: Record<string, unknown>) => {
    h.platformAudited.push(input);
  }),
}));

import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { TOTP_RESET_DATA, totpResetRefusal } from "@/server/auth/totp-reset";
import { redactStaffUser } from "@/server/users/staff-user";
import { POST as resetTotp } from "@/app/api/crm/users/[id]/reset-totp/route";
import { PATCH as platformPatch } from "@/app/api/platform/users/[id]/route";

function reset(id: string, currentPassword: string) {
  return resetTotp(
    new Request(`https://x/api/crm/users/${id}/reset-totp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword }),
    }),
  );
}

beforeEach(async () => {
  __resetRateLimitsForTests();
  h.admin.passwordHash = await bcrypt.hash("admin-password", 4);
  h.target = {
    id: "doc1",
    role: "DOCTOR",
    clinicId: "c1",
    active: true,
    totpEnabledAt: new Date("2026-09-01T00:00:00Z"),
  };
  h.updates = [];
  h.audited = [];
  h.platformAudited = [];
  h.revoke.mockClear();
});

describe("totpResetRefusal", () => {
  const enrolled = { id: "u2", role: "DOCTOR", totpEnabledAt: new Date() };
  it("refuses your own account, a SUPER_ADMIN and a user without 2FA", () => {
    expect(totpResetRefusal({ actorId: "u2", target: enrolled })).toBe("cannot_reset_self");
    expect(
      totpResetRefusal({ actorId: "a", target: { ...enrolled, role: "SUPER_ADMIN" } }),
    ).toBe("super_admin_target");
    expect(
      totpResetRefusal({ actorId: "a", target: { ...enrolled, totpEnabledAt: null } }),
    ).toBe("not_enrolled");
    expect(totpResetRefusal({ actorId: "a", target: enrolled })).toBeNull();
  });
});

describe("POST /api/crm/users/[id]/reset-totp", () => {
  it("wipes the enrolment, ends the sessions and audits it", async () => {
    const r = await reset("doc1", "admin-password");
    expect(r.status).toBe(200);
    expect(h.targetWhere).toEqual({ id: "doc1", clinicId: "c1" });
    expect(h.updates).toEqual([{ where: { id: "doc1" }, data: TOTP_RESET_DATA }]);
    expect(TOTP_RESET_DATA).toMatchObject({
      totpSecret: null,
      totpEnabledAt: null,
      recoveryCodesHash: [],
      pendingTotpSecret: null,
    });
    expect(h.revoke).toHaveBeenCalledWith("doc1");
    expect(h.audited[0]).toMatchObject({
      action: AUDIT_ACTION.TOTP_RESET_BY_ADMIN,
      entityId: "doc1",
      meta: { by: "admin1", via: "clinic", revokedSessions: 3 },
    });
  });

  it("needs the admin's own password", async () => {
    const r = await reset("doc1", "wrong");
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ reason: "wrong_password" });
    expect(h.updates).toHaveLength(0);
    expect(h.revoke).not.toHaveBeenCalled();
  });

  it("another clinic's user is not found", async () => {
    h.target = null;
    expect((await reset("doc1", "admin-password")).status).toBe(404);
  });

  it("not on your own account, nor on a user without 2FA", async () => {
    h.target = { ...h.target, id: "admin1" };
    h.admin = { ...h.admin };
    const self = await resetTotp(
      new Request("https://x/api/crm/users/admin1/reset-totp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "admin-password" }),
      }),
    );
    expect(self.status).toBe(409);
    expect(await self.json()).toMatchObject({ reason: "cannot_reset_self" });

    h.target = { id: "doc1", role: "DOCTOR", totpEnabledAt: null };
    const none = await reset("doc1", "admin-password");
    expect(none.status).toBe(409);
    expect(await none.json()).toMatchObject({ reason: "not_enrolled" });
    expect(h.updates).toHaveLength(0);
  });
});

describe("PATCH /api/platform/users/[id] { resetTotp }", () => {
  it("resets a clinic's only admin and leaves its own audit row", async () => {
    h.target = {
      id: "adm9",
      role: "ADMIN",
      clinicId: "c1",
      active: true,
      totpEnabledAt: new Date(),
    };
    const r = await platformPatch(
      new Request("https://x/api/platform/users/adm9", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resetTotp: true }),
      }),
    );
    expect(r.status).toBe(200);
    expect(h.updates[0]!.data).toMatchObject(TOTP_RESET_DATA);
    expect(h.revoke).toHaveBeenCalledWith("adm9");
    expect(
      h.platformAudited.find((a) => a.action === AUDIT_ACTION.TOTP_RESET_BY_ADMIN),
    ).toMatchObject({ entityId: "adm9", meta: { by: "sa1", via: "platform" } });
  });
});

describe("redactStaffUser", () => {
  it("keeps TOTP material on the server and says whether 2FA is on", () => {
    const view = redactStaffUser({
      id: "u1",
      name: "Азиз",
      passwordHash: "h",
      totpSecret: "cipher",
      pendingTotpSecret: "cipher2",
      pendingTotpExpiresAt: new Date(),
      recoveryCodesHash: ["x"],
      totpEnabledAt: new Date(),
    });
    expect(view).toEqual({
      id: "u1",
      name: "Азиз",
      totpEnabledAt: expect.any(Date),
      totpEnabled: true,
    });
    expect(redactStaffUser({ id: "u2", totpEnabledAt: null }).totpEnabled).toBe(false);
  });
});
