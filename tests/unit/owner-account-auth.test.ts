/**
 * Owner account P0, auth core (owner request 09.10.2026,
 * docs/design/OWNER-ACCOUNT.md §0 and §2):
 *   - the JWT honours a clinic visit only with a grant of THIS SUPER_ADMIN
 *     (only the clinic was compared, so another admin on the same browser
 *     carried on the first one's grant);
 *   - sign-out ends the live grant, journals it and clears both cookies, and a
 *     JWT refresh refuses the ended grant even if a cookie survived;
 *   - the session exposes the lease end and its 8 h cap for the banner;
 *   - a SUPER_ADMIN sign-in mints its session with the role, so it keeps 3.
 *
 * The real grant helpers (src/server/platform/impersonation.ts) run against a
 * mocked Prisma; NextAuth's config object is captured and driven directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type GrantRow = {
  id: string;
  superAdminId: string;
  clinicId: string;
  reason: string;
  mode: "WRITE" | "VIEW_ONLY";
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  endedReason: string | null;
};

const h = vi.hoisted(() => ({
  config: null as null | {
    callbacks: {
      jwt: (args: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
      session: (args: { session: { user: Record<string, unknown> }; token: Record<string, unknown> }) => Promise<{ user: Record<string, unknown> }>;
    };
    events: { signOut: (m: { token: Record<string, unknown> | null }) => Promise<void> };
  },
  cookieJar: new Map<string, string>(),
  grants: new Map<string, GrantRow>(),
  audits: [] as Array<Record<string, unknown>>,
  mint: vi.fn(async () => ({ sessionId: "s-new", token: "tok" })),
  evaluate: vi.fn(async () => ({ ok: true, sessionId: "s1", fresh: null })),
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
  headers: async () => new Headers({ "x-real-ip": "203.0.113.5", "user-agent": "owner-laptop" }),
  cookies: async () => ({
    get: (name: string) =>
      h.cookieJar.has(name) ? { name, value: h.cookieJar.get(name)! } : undefined,
    set: (name: unknown, value?: string) => {
      if (typeof name === "string") h.cookieJar.set(name, value ?? "");
    },
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), update: vi.fn() },
    userSession: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    impersonationGrant: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = h.grants.get(where.id);
        return row ? { ...row } : null;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; endedAt?: null }; data: Partial<GrantRow> }) => {
          const row = h.grants.get(where.id);
          if (!row || (where.endedAt === null && row.endedAt !== null)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.audits.push(data);
        return {};
      }),
    },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
  runUnscoped: <T,>(_r: string, fn: () => T) => Promise.resolve(fn()),
}));
// The signed override cookie, minus the HMAC: "signed:<clinicId>".
vi.mock("@/server/platform/clinic-override", () => ({
  OVERRIDE_COOKIE_NAME: "admin_clinic_override",
  verifyClinicOverride: (v: string | null) =>
    v && v.startsWith("signed:") ? v.slice("signed:".length) : null,
}));
vi.mock("@/server/auth/user-session", () => ({
  SESSION_COOKIE_NAME: "crm_user_session",
  hashSessionToken: (t: string) => `hash(${t})`,
  mintUserSessionOnSignIn: h.mint,
}));
vi.mock("@/server/auth/session-guard", () => ({
  evaluateStaffSession: h.evaluate,
  deleteSessionById: vi.fn(async () => {}),
}));
vi.mock("@/server/auth/login-audit", () => ({ recordLoginEvent: vi.fn(async () => {}) }));

import "@/lib/auth";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { IMPERSONATION_MAX_MS } from "@/server/platform/impersonation";

function cfg() {
  if (!h.config) throw new Error("NextAuth config not captured");
  return h.config;
}

const MIN = 60_000;

function liveGrant(over: Partial<GrantRow> = {}): GrantRow {
  return {
    id: "gA",
    superAdminId: "sa1",
    clinicId: "cA",
    reason: "support ticket",
    mode: "VIEW_ONLY",
    startedAt: new Date(Date.now() - 20 * MIN),
    expiresAt: new Date(Date.now() + 40 * MIN),
    endedAt: null,
    endedReason: null,
    ...over,
  };
}

function enterClinic(grant: GrantRow) {
  h.grants.set(grant.id, grant);
  h.cookieJar.set("admin_clinic_override", `signed:${grant.clinicId}`);
  h.cookieJar.set("admin_grant_id", grant.id);
}

const superToken = (userId: string) => ({
  userId,
  sub: userId,
  role: "SUPER_ADMIN",
  clinicId: null,
  sid: `sid-${userId}`,
});

beforeEach(() => {
  h.cookieJar.clear();
  h.grants.clear();
  h.audits = [];
  h.mint.mockImplementation(async () => ({ sessionId: "s-new", token: "tok" }));
  h.evaluate.mockImplementation(async () => ({ ok: true, sessionId: "s1", fresh: null }));
});

describe("the JWT binds a clinic visit to its own admin", () => {
  it("honours the admin's own live grant and stamps its lease", async () => {
    const grant = liveGrant();
    enterClinic(grant);
    const token = await cfg().callbacks.jwt({ token: superToken("sa1") });
    expect(token).toMatchObject({
      clinicId: "cA",
      impersonationGrantId: "gA",
      impersonationMode: "VIEW_ONLY",
      impersonationExpiresAt: grant.expiresAt.getTime(),
      impersonationMaxExpiresAt: grant.startedAt.getTime() + IMPERSONATION_MAX_MS,
    });
  });

  it("refuses a live grant of another SUPER_ADMIN on the same browser", async () => {
    enterClinic(liveGrant({ superAdminId: "sa1" }));
    const token = await cfg().callbacks.jwt({ token: { ...superToken("sa2"), clinicId: "cA" } });
    expect(token).toMatchObject({
      clinicId: null,
      impersonationGrantId: null,
      impersonationMode: null,
      impersonationExpiresAt: null,
    });
  });

  it("still refuses a clinic that does not match the grant", async () => {
    enterClinic(liveGrant());
    h.cookieJar.set("admin_clinic_override", "signed:cOther");
    const token = await cfg().callbacks.jwt({ token: superToken("sa1") });
    expect(token).toMatchObject({ clinicId: null, impersonationGrantId: null });
  });

  it("the session hands the banner the lease end and its 8 h cap", async () => {
    const grant = liveGrant();
    enterClinic(grant);
    const token = await cfg().callbacks.jwt({ token: superToken("sa1") });
    const s = await cfg().callbacks.session({ session: { user: {} }, token: token! });
    expect(s.user.impersonation).toEqual({
      grantId: "gA",
      mode: "VIEW_ONLY",
      expiresAt: grant.expiresAt.toISOString(),
      maxExpiresAt: new Date(grant.startedAt.getTime() + IMPERSONATION_MAX_MS).toISOString(),
    });
  });
});

describe("sign-out ends the visit", () => {
  const ended = () =>
    h.audits.filter((a) => a.action === AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_ENDED);

  it("ends the live grant, journals it and clears both cookies", async () => {
    enterClinic(liveGrant());
    await cfg().events.signOut({ token: { ...superToken("sa1"), impersonationGrantId: "gA" } });
    expect(h.grants.get("gA")).toMatchObject({ endedReason: "user_exit" });
    expect(h.grants.get("gA")!.endedAt).toBeInstanceOf(Date);
    expect(ended()).toHaveLength(1);
    expect(ended()[0]).toMatchObject({
      clinicId: "cA",
      actorId: "sa1",
      actorRole: "SUPER_ADMIN",
      entityId: "gA",
      ip: "203.0.113.5",
      meta: { clinicId: "cA", via: "sign_out" },
    });
    expect(h.cookieJar.get("admin_clinic_override")).toBe("");
    expect(h.cookieJar.get("admin_grant_id")).toBe("");
  });

  it("finds the grant by its cookie when the stored JWT predates it", async () => {
    enterClinic(liveGrant());
    await cfg().events.signOut({ token: superToken("sa1") });
    expect(h.grants.get("gA")!.endedAt).not.toBeNull();
  });

  it("a later JWT refresh refuses the ended grant even if its cookies survived", async () => {
    enterClinic(liveGrant());
    await cfg().events.signOut({ token: superToken("sa1") });
    // Same browser, the admin signs back in; the cookies came back somehow.
    h.cookieJar.set("admin_clinic_override", "signed:cA");
    h.cookieJar.set("admin_grant_id", "gA");
    const token = await cfg().callbacks.jwt({ token: superToken("sa1") });
    expect(token).toMatchObject({ clinicId: null, impersonationGrantId: null });
  });

  it("never ends a grant of another admin, but still clears the cookies", async () => {
    enterClinic(liveGrant({ superAdminId: "sa1" }));
    await cfg().events.signOut({ token: superToken("sa2") });
    expect(h.grants.get("gA")!.endedAt).toBeNull();
    expect(ended()).toHaveLength(0);
    expect(h.cookieJar.get("admin_grant_id")).toBe("");
  });

  it("an ended grant is not journaled twice", async () => {
    enterClinic(liveGrant({ endedAt: new Date(), endedReason: "user_exit" }));
    await cfg().events.signOut({ token: superToken("sa1") });
    expect(ended()).toHaveLength(0);
  });

  it("clinic staff signing out leave the grant table alone", async () => {
    enterClinic(liveGrant());
    await cfg().events.signOut({
      token: { userId: "d1", sub: "d1", role: "DOCTOR", clinicId: "cA", sid: "s-d1" },
    });
    expect(h.grants.get("gA")!.endedAt).toBeNull();
    expect(h.cookieJar.get("admin_clinic_override")).toBe("");
  });
});

describe("sign-in hands the role to the session minting", () => {
  it("passes SUPER_ADMIN so the owner keeps his other devices", async () => {
    await cfg().callbacks.jwt({
      token: {},
      user: { id: "sa1", role: "SUPER_ADMIN", clinicId: null },
    });
    expect(h.mint).toHaveBeenCalledWith("sa1", null, "SUPER_ADMIN");
  });
});
