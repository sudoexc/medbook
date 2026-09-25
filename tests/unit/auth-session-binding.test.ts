import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

/**
 * Audit SEC-02 / SEC-05 / SEC-06 / SEC-07 — the NextAuth configuration.
 *
 * `auth()` runs the `jwt` callback on every call, so this is where a JWT is
 * tied to its server-side UserSession and where a revoked, idled-out or
 * deactivated session turns into "no session" for pages and APIs alike. The
 * credentials `authorize` is where failed passwords are counted.
 *
 * We capture the config object handed to NextAuth() and drive the callbacks
 * directly.
 */

const h = vi.hoisted(() => ({
  config: null as null | {
    callbacks: {
      jwt: (args: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
      session: (args: { session: { user: Record<string, unknown> }; token: Record<string, unknown> }) => Promise<{ user: Record<string, unknown> }>;
    };
    events: { signOut: (m: { token: Record<string, unknown> | null }) => Promise<void> };
    providers: Array<{ options: { authorize: (c: Record<string, string>, r: Request) => Promise<unknown> } }>;
  },
  cookieJar: new Map<string, string>(),
  users: new Map<string, Record<string, unknown>>(),
  mint: vi.fn(async () => ({ sessionId: "s-new", token: "tok" })),
  evaluate: vi.fn(),
  deleteSessionById: vi.fn(async () => {}),
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
  cookies: async () => ({
    get: (name: string) =>
      h.cookieJar.has(name) ? { name, value: h.cookieJar.get(name)! } : undefined,
    set: (name: string, value: string) => {
      h.cookieJar.set(name, value);
    },
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => h.users.get(where.email) ?? null),
      update: vi.fn(async () => ({})),
    },
    userSession: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: { create: vi.fn(async () => ({})) },
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
vi.mock("@/server/auth/totp", () => ({ verifyTotpCode: () => false }));
vi.mock("@/server/crypto/secret-fields", () => ({ readTotpSecret: (s: string) => s }));
vi.mock("@/server/auth/recovery-codes", () => ({
  consumeRecoveryCode: async () => ({ ok: false }),
}));
vi.mock("@/server/auth/user-session", () => ({
  SESSION_COOKIE_NAME: "crm_user_session",
  hashSessionToken: (t: string) => `hash(${t})`,
  mintUserSessionOnSignIn: h.mint,
}));
vi.mock("@/server/auth/session-guard", () => ({
  evaluateStaffSession: h.evaluate,
  deleteSessionById: h.deleteSessionById,
}));

import "@/lib/auth";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";

function cfg() {
  if (!h.config) throw new Error("NextAuth config not captured");
  return h.config;
}

beforeEach(() => {
  h.cookieJar.clear();
  h.users.clear();
  h.mint.mockClear();
  h.mint.mockImplementation(async () => ({ sessionId: "s-new", token: "tok" }));
  h.evaluate.mockReset();
  h.deleteSessionById.mockClear();
  __resetRateLimitsForTests();
  delete process.env.DISABLE_AUTH_RATE_LIMIT;
});

describe("jwt callback: sign-in", () => {
  it("binds the JWT to the freshly minted UserSession and notes a temp-password sign-in", async () => {
    const token = await cfg().callbacks.jwt({
      token: {},
      user: { id: "u1", role: "DOCTOR", clinicId: "c1", mustChangePassword: true },
    });
    expect(h.mint).toHaveBeenCalledWith("u1", "c1");
    expect(token).toMatchObject({ sid: "s-new", sidUnbound: false, role: "DOCTOR" });
    expect(typeof token!.pwTempAt).toBe("number");
    // Sign-in itself is never re-validated against a row that is being made.
    expect(h.evaluate).not.toHaveBeenCalled();
  });

  it("a normal sign-in carries no temp-password stamp", async () => {
    const token = await cfg().callbacks.jwt({
      token: {},
      user: { id: "u1", role: "ADMIN", clinicId: "c1", mustChangePassword: false },
    });
    expect(token!.pwTempAt).toBeNull();
  });

  it("if the session row cannot be minted, the sign-in still works (no login loop)", async () => {
    h.mint.mockImplementation(async () => {
      throw new Error("db blip");
    });
    const token = await cfg().callbacks.jwt({
      token: {},
      user: { id: "u1", role: "ADMIN", clinicId: "c1" },
    });
    expect(token).toMatchObject({ sid: null, sidUnbound: true });
  });
});

describe("jwt callback: every later auth() call", () => {
  const base = { userId: "u1", sub: "u1", role: "ADMIN", clinicId: "c1", mustChangePassword: true, pwTempAt: 123 };

  it("checks the session named in the JWT and applies the account's current claims", async () => {
    h.evaluate.mockResolvedValue({
      ok: true,
      sessionId: "s1",
      fresh: { role: "RECEPTIONIST", clinicId: "c1", mustChangePassword: false },
    });
    const token = await cfg().callbacks.jwt({ token: { ...base, sid: "s1" } });
    expect(h.evaluate).toHaveBeenCalledWith({
      claims: { userId: "u1", role: "ADMIN", clinicId: "c1" },
      binding: { kind: "sid", sessionId: "s1" },
    });
    expect(token).toMatchObject({ role: "RECEPTIONIST", mustChangePassword: false, pwTempAt: null });
  });

  it("returns no session at all when the guard says no (pages → /login, APIs → 401)", async () => {
    h.evaluate.mockResolvedValue({ ok: false, reason: "idle", sessionId: "s1" });
    expect(await cfg().callbacks.jwt({ token: { ...base, sid: "s1" } })).toBeNull();
  });

  it("a pre-deploy JWT is checked through the session cookie", async () => {
    h.cookieJar.set("crm_user_session", "legacy-token");
    h.evaluate.mockResolvedValue({ ok: true, sessionId: "old", fresh: null });
    await cfg().callbacks.jwt({ token: { ...base } });
    expect(h.evaluate.mock.calls[0]![0].binding).toEqual({
      kind: "cookie",
      tokenHash: "hash(legacy-token)",
    });
  });

  it("a JWT with neither a session id nor a session cookie is checked as unbound-to-nothing", async () => {
    h.evaluate.mockResolvedValue({ ok: false, reason: "expired", sessionId: null });
    const token = await cfg().callbacks.jwt({ token: { ...base } });
    expect(h.evaluate.mock.calls[0]![0].binding).toEqual({ kind: "none" });
    expect(token).toBeNull();
  });

  it("the session exposes its session id and temp-password stamp to the server", async () => {
    const s = await cfg().callbacks.session({
      session: { user: {} },
      token: { ...base, sid: "s1", pwTempAt: 555 },
    });
    expect(s.user).toMatchObject({ id: "u1", sessionId: "s1", tempPasswordLoginAt: 555 });
  });
});

describe("sign-out", () => {
  it("deletes the server-side session, so a copied JWT stops working", async () => {
    await cfg().events.signOut({ token: { sid: "s1" } });
    expect(h.deleteSessionById).toHaveBeenCalledWith("s1");
    expect(h.cookieJar.get("crm_user_session")).toBe("");
  });
});

describe("authorize: failed attempts are counted per real IP + email (SEC-02/SEC-03)", () => {
  const req = (ip: string, spoof?: string) =>
    new Request("https://x/api/auth/callback/credentials", {
      headers: { "x-real-ip": ip, ...(spoof ? { "x-forwarded-for": spoof } : {}) },
    });

  it("locks the email after 5 wrong passwords, even for the right one and a spoofed X-Forwarded-For", async () => {
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
    const authorize = cfg().providers[0]!.options.authorize;
    for (let i = 0; i < 5; i++) {
      expect(
        await authorize({ email: "doc@x.uz", password: `wrong-${i}` }, req("198.51.100.7", `10.0.0.${i}`)),
      ).toBeNull();
    }
    expect(
      await authorize({ email: "doc@x.uz", password: "right-password" }, req("198.51.100.7", "1.2.3.4")),
    ).toBeNull();
  });

  it("successful sign-ins never count: ten in a row from one office IP all pass", async () => {
    const hash = await bcrypt.hash("pw", 4);
    const authorize = cfg().providers[0]!.options.authorize;
    for (let i = 0; i < 10; i++) {
      h.users.set(`s${i}@x.uz`, {
        id: `u${i}`,
        email: `s${i}@x.uz`,
        name: "S",
        role: "RECEPTIONIST",
        clinicId: "c1",
        active: true,
        passwordHash: hash,
        mustChangePassword: false,
        totpEnabledAt: null,
      });
      expect(await authorize({ email: `s${i}@x.uz`, password: "pw" }, req("203.0.113.1"))).toMatchObject({
        id: `u${i}`,
      });
    }
  });

  it("an unknown email is refused like a wrong password (and counted)", async () => {
    const authorize = cfg().providers[0]!.options.authorize;
    for (let i = 0; i < 5; i++) {
      expect(await authorize({ email: "ghost@x.uz", password: "p" }, req("192.0.2.9"))).toBeNull();
    }
    const { checkLoginThrottle } = await import("@/server/auth/login-throttle");
    expect(checkLoginThrottle({ ip: "192.0.2.9", email: "ghost@x.uz" }).blocked).toBe(true);
  });
});

describe("jwt callback: the guard itself failing", () => {
  it("fails open instead of signing everybody out", async () => {
    h.evaluate.mockRejectedValue(new Error("bug"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const token = await cfg().callbacks.jwt({
      token: { userId: "u1", sub: "u1", role: "ADMIN", clinicId: "c1", sid: "s1" },
    });
    expect(token).toMatchObject({ role: "ADMIN", clinicId: "c1" });
  });
});
