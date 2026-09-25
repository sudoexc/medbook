import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

/**
 * Audit SEC-07 — password change and reset.
 *
 *   - POST /api/crm/me/password needs the current password from any session
 *     except the one freshly opened with the temporary password (and only for
 *     a short window). Before, `mustChangePassword=true` alone was enough, so
 *     an intruder whose session survived a reset could set their own password;
 *   - changing the password ends the account's OTHER sessions;
 *   - an admin reset ends ALL of the user's sessions, so the old session gets
 *     401 on its next request.
 */

const h = vi.hoisted(() => ({
  session: null as null | { user: Record<string, unknown> },
  user: null as null | { id: string; passwordHash: string; mustChangePassword: boolean; clinicId?: string },
  updates: [] as Array<Record<string, unknown>>,
  revoke: vi.fn(async () => 2),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => h.user),
      findFirst: vi.fn(async () => h.user),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.updates.push(data);
        return { ...h.user, ...data };
      }),
      count: vi.fn(async () => 1),
    },
    doctor: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { update: vi.fn(async () => ({})) },
        doctor: { updateMany: vi.fn(async () => ({ count: 0 })) },
      }),
    ),
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/server/auth/session-guard", () => ({
  revokeUserSessions: h.revoke,
  invalidateSessionGuardCache: vi.fn(),
}));
vi.mock("@/server/auth/user-session", () => ({
  findSessionByCookie: vi.fn(async () => null),
  readSessionCookie: vi.fn(async () => null),
}));

import {
  TEMP_PASSWORD_GRACE_MS,
  changePasswordView,
  mayOmitCurrentPassword,
} from "@/server/auth/password-change";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import { POST as changeOwnPassword } from "@/app/api/crm/me/password/route";
import { POST as adminReset } from "@/app/api/crm/users/[id]/reset-password/route";
import { DELETE as deactivateUser } from "@/app/api/crm/users/[id]/route";

function post(body: unknown) {
  return changeOwnPassword(
    new Request("https://x/api/crm/me/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  __resetRateLimitsForTests();
  h.updates = [];
  h.revoke.mockClear();
  h.user = {
    id: "u1",
    passwordHash: await bcrypt.hash("temp-password", 4),
    mustChangePassword: true,
    clinicId: "c1",
  };
});

describe("mayOmitCurrentPassword", () => {
  const now = 10_000_000;
  it("only the fresh temp-password session, inside the window", () => {
    const base = { hasPassword: true, mustChangePassword: true, now };
    expect(mayOmitCurrentPassword({ ...base, tempPasswordLoginAt: now - 60_000 })).toBe(true);
    expect(mayOmitCurrentPassword({ ...base, tempPasswordLoginAt: now - TEMP_PASSWORD_GRACE_MS - 1 })).toBe(false);
    expect(mayOmitCurrentPassword({ ...base, tempPasswordLoginAt: null })).toBe(false);
    expect(mayOmitCurrentPassword({ ...base, mustChangePassword: false, tempPasswordLoginAt: now })).toBe(false);
  });

  it("the page asks for the current password exactly when the API will", () => {
    expect(changePasswordView({ mustChangePassword: true, tempPasswordLoginAt: Date.now() })).toEqual({
      forced: true,
      requireCurrent: false,
    });
    expect(changePasswordView({ mustChangePassword: true, tempPasswordLoginAt: null })).toEqual({
      forced: true,
      requireCurrent: true,
    });
    expect(changePasswordView({ mustChangePassword: false })).toEqual({
      forced: false,
      requireCurrent: true,
    });
  });
});

describe("POST /api/crm/me/password", () => {
  it("a session opened before the reset cannot set a password without the current one", async () => {
    h.session = { user: { id: "u1", role: "DOCTOR", sessionId: "old", tempPasswordLoginAt: null } };
    const r = await post({ newPassword: "brand-new-password" });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ reason: "current_required" });
    expect(h.updates).toHaveLength(0);
  });

  it("the session that just signed in with the temp password may skip it", async () => {
    h.session = { user: { id: "u1", role: "DOCTOR", sessionId: "s-new", tempPasswordLoginAt: Date.now() - 60_000 } };
    const r = await post({ newPassword: "brand-new-password" });
    expect(r.status).toBe(200);
    expect(h.updates[0]).toMatchObject({ mustChangePassword: false });
    // Every other session of the account is ended; this one stays.
    expect(h.revoke).toHaveBeenCalledWith("u1", { exceptSessionId: "s-new" });
  });

  it("after the grace window even that session must type the temp password", async () => {
    h.session = {
      user: { id: "u1", role: "DOCTOR", sessionId: "s-new", tempPasswordLoginAt: Date.now() - TEMP_PASSWORD_GRACE_MS - 1000 },
    };
    expect((await post({ newPassword: "brand-new-password" })).status).toBe(400);
    const ok = await post({ currentPassword: "temp-password", newPassword: "brand-new-password" });
    expect(ok.status).toBe(200);
  });

  it("a voluntary change with a wrong current password is refused", async () => {
    h.user!.mustChangePassword = false;
    h.session = { user: { id: "u1", role: "ADMIN", sessionId: "s1", tempPasswordLoginAt: null } };
    const r = await post({ currentPassword: "nope", newPassword: "brand-new-password" });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "invalid_current" });
    expect(h.revoke).not.toHaveBeenCalled();
  });
});

describe("admin actions end the target's sessions", () => {
  beforeEach(() => {
    h.session = { user: { id: "admin1", role: "ADMIN", clinicId: "c1" } };
  });

  it("reset-password revokes every session of the user", async () => {
    const r = await adminReset(
      new Request("https://x/api/crm/users/u1/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(r.status).toBe(200);
    expect(h.updates[0]).toMatchObject({ mustChangePassword: true });
    expect(h.revoke).toHaveBeenCalledWith("u1");
  });

  it("deactivation revokes every session of the user", async () => {
    (h.user as Record<string, unknown>).role = "RECEPTIONIST";
    const r = await deactivateUser(
      new Request("https://x/api/crm/users/u1", { method: "DELETE" }),
    );
    expect(r.status).toBe(200);
    expect(h.revoke).toHaveBeenCalledWith("u1");
  });
});
