/**
 * Audit G1-04: staff sign-ins, failed attempts and sign-outs were nowhere in
 * the audit log. A leaked password could not be investigated (when, from
 * where) and a password-guessing run left no trace.
 *
 * Acceptance: a wrong password, then a right sign-in, then a sign-out give
 * three audit rows with the IP and the time; LOGIN_FAILED rows can be
 * filtered to see guessing; nothing secret is stored.
 */
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AuditRow = Record<string, unknown> & { action: string; meta: unknown };

const h = vi.hoisted(() => ({
  config: null as null | {
    events: { signOut: (m: { token: Record<string, unknown> | null }) => Promise<void> };
    providers: Array<{
      options: { authorize: (c: Record<string, string>, r: Request) => Promise<unknown> };
    }>;
  },
  users: new Map<string, Record<string, unknown>>(),
  audits: [] as AuditRow[],
  requestHeaders: new Headers(),
}));

vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    h.config = config as typeof h.config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => ({ id: "credentials", type: "credentials", options }),
}));
vi.mock("next/headers", () => ({
  headers: async () => h.requestHeaders,
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => h.users.get(where.email) ?? null),
      update: vi.fn(async () => ({})),
    },
    userSession: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: {
      create: vi.fn(async ({ data }: { data: AuditRow }) => {
        h.audits.push(data);
        return data;
      }),
    },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
  runUnscoped: <T,>(_r: string, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("@/server/platform/clinic-override", () => ({
  OVERRIDE_COOKIE_NAME: "admin_clinic_override",
  verifyClinicOverride: () => null,
}));
vi.mock("@/server/auth/totp", () => ({ verifyTotpCode: (_s: string, code: string) => code === "123456" }));
vi.mock("@/server/crypto/secret-fields", () => ({ readTotpSecret: (s: string) => s }));
vi.mock("@/server/auth/recovery-codes", () => ({
  consumeRecoveryCode: async () => ({ ok: false }),
}));
vi.mock("@/server/auth/user-session", () => ({
  SESSION_COOKIE_NAME: "crm_user_session",
  hashSessionToken: (t: string) => `hash(${t})`,
  mintUserSessionOnSignIn: vi.fn(async () => ({ sessionId: "s1", token: "t" })),
}));
vi.mock("@/server/auth/session-guard", () => ({
  evaluateStaffSession: vi.fn(),
  deleteSessionById: vi.fn(async () => undefined),
}));
vi.mock("@/server/auth/login-sources", () => ({
  isKnownLoginSource: async () => false,
  rememberLoginSource: vi.fn(async () => undefined),
}));

import "@/lib/auth";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import { AUDIT_ACTION } from "@/lib/audit-actions";

const cfg = () => h.config!;
const req = (ip: string) =>
  new Request("https://x/api/auth/callback/credentials", {
    headers: { "x-real-ip": ip, "user-agent": "Firefox/140" },
  });

beforeEach(async () => {
  h.users.clear();
  h.audits = [];
  h.requestHeaders = new Headers({ "x-real-ip": "203.0.113.9", "user-agent": "Firefox/140" });
  __resetRateLimitsForTests();
  h.users.set("doc@x.uz", {
    id: "u1",
    email: "doc@x.uz",
    name: "Doc",
    role: "DOCTOR",
    clinicId: "c1",
    active: true,
    passwordHash: await bcrypt.hash("right-password", 4),
    mustChangePassword: false,
    totpEnabledAt: null,
  });
});

describe("sign-in history in the audit log", () => {
  it("wrong password, right sign-in, sign-out: three rows with IP and agent", async () => {
    const authorize = cfg().providers[0]!.options.authorize;
    expect(await authorize({ email: "doc@x.uz", password: "nope" }, req("198.51.100.7"))).toBeNull();
    expect(
      await authorize({ email: "doc@x.uz", password: "right-password" }, req("198.51.100.7")),
    ).toMatchObject({ id: "u1" });
    await cfg().events.signOut({ token: { sid: "s1", userId: "u1", role: "DOCTOR", clinicId: "c1" } });

    expect(h.audits.map((a) => a.action)).toEqual([
      AUDIT_ACTION.LOGIN_FAILED,
      AUDIT_ACTION.LOGIN_SUCCEEDED,
      AUDIT_ACTION.LOGOUT,
    ]);
    const [failed, ok, out] = h.audits;
    expect(failed).toMatchObject({
      clinicId: "c1",
      actorId: null,
      actorLabel: "doc@x.uz",
      entityType: "User",
      entityId: "u1",
      meta: { reason: "bad_password" },
      ip: "198.51.100.7",
      userAgent: "Firefox/140",
    });
    expect(ok).toMatchObject({ actorId: "u1", clinicId: "c1", ip: "198.51.100.7" });
    expect(out).toMatchObject({ actorId: "u1", clinicId: "c1", ip: "203.0.113.9" });
    // Nothing secret anywhere.
    expect(JSON.stringify(h.audits)).not.toContain("nope");
    expect(JSON.stringify(h.audits)).not.toContain("right-password");
  });

  it("an unknown email is recorded with the typed email and no clinic", async () => {
    const authorize = cfg().providers[0]!.options.authorize;
    await authorize({ email: "ghost@x.uz", password: "x" }, req("192.0.2.1"));
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: AUDIT_ACTION.LOGIN_FAILED,
        clinicId: null,
        entityId: null,
        actorLabel: "ghost@x.uz",
        meta: { reason: "unknown_user" },
        ip: "192.0.2.1",
      }),
    ]);
  });

  it("an inactive account and a bad second factor say so", async () => {
    const authorize = cfg().providers[0]!.options.authorize;
    h.users.set("doc@x.uz", { ...h.users.get("doc@x.uz")!, active: false });
    await authorize({ email: "doc@x.uz", password: "right-password" }, req("192.0.2.2"));
    h.users.set("doc@x.uz", {
      ...h.users.get("doc@x.uz")!,
      active: true,
      totpEnabledAt: new Date(),
      totpSecret: "secret",
    });
    const prev = process.env.DISABLE_2FA;
    delete process.env.DISABLE_2FA;
    try {
      await authorize({ email: "doc@x.uz", password: "right-password", totp: "000000" }, req("192.0.2.2"));
      await authorize({ email: "doc@x.uz", password: "right-password" }, req("192.0.2.2"));
      await authorize({ email: "doc@x.uz", password: "right-password", totp: "123456" }, req("192.0.2.2"));
    } finally {
      if (prev !== undefined) process.env.DISABLE_2FA = prev;
    }
    expect(h.audits.map((a) => [a.action, (a.meta as { reason?: string } | null)?.reason])).toEqual([
      [AUDIT_ACTION.LOGIN_FAILED, "inactive"],
      [AUDIT_ACTION.LOGIN_FAILED, "bad_totp"],
      [AUDIT_ACTION.LOGIN_FAILED, "totp_required"],
      [AUDIT_ACTION.LOGIN_SUCCEEDED, undefined],
    ]);
    expect(h.audits[3]!.meta).toEqual({ via: "totp" });
    expect(JSON.stringify(h.audits)).not.toContain("123456");
  });

  it("an impersonating SUPER_ADMIN's sign-out is a platform row, not the clinic's", async () => {
    await cfg().events.signOut({
      token: { sid: "s9", userId: "su1", role: "SUPER_ADMIN", clinicId: "c9" },
    });
    expect(h.audits).toEqual([
      expect.objectContaining({ action: AUDIT_ACTION.LOGOUT, actorId: "su1", clinicId: null }),
    ]);
  });

  it("a dead audit table never blocks a sign-in", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.auditLog.create).mockRejectedValueOnce(new Error("db down"));
    const authorize = cfg().providers[0]!.options.authorize;
    expect(
      await authorize({ email: "doc@x.uz", password: "right-password" }, req("198.51.100.7")),
    ).toMatchObject({ id: "u1" });
  });
});
