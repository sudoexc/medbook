/**
 * Audit CM-15: a password change leaves an audit trail and is capped at
 * five attempts per 15 minutes; turning 2FA off respects the clinic's
 * «2FA для всех» policy, not only the always-mandatory roles.
 */
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as null | { user: Record<string, unknown> },
  user: null as null | Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  audited: [] as Array<Record<string, unknown>>,
  revoke: vi.fn(async () => 2),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => h.user),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.updates.push(data);
        return { ...h.user, ...data };
      }),
    },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
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
vi.mock("@/server/auth/user-session", () => ({
  findSessionByCookie: vi.fn(async () => null),
  readSessionCookie: vi.fn(async () => null),
}));

import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { isTotpMandatory } from "@/server/auth/security-policy";
import { POST as changePassword } from "@/app/api/crm/me/password/route";
import { POST as disableTotp } from "@/app/api/crm/me/totp/disable/route";

function post(handler: (r: Request) => Promise<Response>, url: string, body: unknown) {
  return handler(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  __resetRateLimitsForTests();
  h.updates = [];
  h.audited = [];
  h.revoke.mockClear();
  h.session = {
    user: { id: "u1", role: "RECEPTIONIST", sessionId: "s1", tempPasswordLoginAt: null },
  };
  h.user = {
    id: "u1",
    role: "RECEPTIONIST",
    passwordHash: await bcrypt.hash("old-password", 4),
    mustChangePassword: false,
    totpEnabledAt: new Date("2026-09-01T00:00:00Z"),
    clinic: { require2faForAll: false },
  };
});

describe("POST /api/crm/me/password", () => {
  it("writes PASSWORD_CHANGED, never the password itself", async () => {
    const r = await post(changePassword, "https://x/api/crm/me/password", {
      currentPassword: "old-password",
      newPassword: "brand-new-password",
    });
    expect(r.status).toBe(200);
    expect(h.audited).toHaveLength(1);
    expect(h.audited[0]).toMatchObject({
      action: AUDIT_ACTION.PASSWORD_CHANGED,
      entityType: "User",
      entityId: "u1",
      meta: { revokedSessions: 2, temporaryPasswordFlow: false },
    });
    expect(JSON.stringify(h.audited[0])).not.toContain("brand-new-password");
  });

  it("a refused change is not audited as a change", async () => {
    const r = await post(changePassword, "https://x/api/crm/me/password", {
      currentPassword: "wrong",
      newPassword: "brand-new-password",
    });
    expect(r.status).toBe(400);
    expect(h.audited).toHaveLength(0);
  });

  it("the sixth attempt within 15 minutes answers 429", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await post(changePassword, "https://x/api/crm/me/password", {
        currentPassword: "wrong",
        newPassword: "brand-new-password",
      });
      expect(r.status).toBe(400);
    }
    const sixth = await post(changePassword, "https://x/api/crm/me/password", {
      currentPassword: "old-password",
      newPassword: "brand-new-password",
    });
    expect(sixth.status).toBe(429);
    expect(h.updates).toHaveLength(0);
  });
});

describe("POST /api/crm/me/totp/disable", () => {
  it("refuses any role while the clinic requires 2FA for all", async () => {
    h.user!.clinic = { require2faForAll: true };
    const r = await post(disableTotp, "https://x/api/crm/me/totp/disable", {
      password: "old-password",
    });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "mandatory_role" });
    expect(h.updates).toHaveLength(0);
  });

  it("refuses an ADMIN whatever the clinic says", async () => {
    h.user!.role = "ADMIN";
    const r = await post(disableTotp, "https://x/api/crm/me/totp/disable", {
      password: "old-password",
    });
    expect(r.status).toBe(403);
  });

  it("lets a voluntary user turn it off, audited", async () => {
    const r = await post(disableTotp, "https://x/api/crm/me/totp/disable", {
      password: "old-password",
    });
    expect(r.status).toBe(200);
    expect(h.updates[0]).toMatchObject({ totpSecret: null, totpEnabledAt: null });
    expect(h.audited[0]).toMatchObject({ action: AUDIT_ACTION.TOTP_DISABLED });
  });

  it("the page and the endpoint share one verdict", () => {
    expect(isTotpMandatory({ role: "RECEPTIONIST", clinicRequire2faForAll: false })).toBe(false);
    expect(isTotpMandatory({ role: "RECEPTIONIST", clinicRequire2faForAll: true })).toBe(true);
    expect(isTotpMandatory({ role: "ADMIN", clinicRequire2faForAll: false })).toBe(true);
  });
});
