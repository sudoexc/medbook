/**
 * Audit G1-04, the browser path: the login form checks the password at
 * /api/crm/auth/totp-required BEFORE NextAuth's signIn, so a wrong password
 * typed at /login is refused there and never reaches `authorize()`. Without
 * a row here, guessing through the real form would still leave no trace.
 */
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => h.users.get(where.email) ?? null),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.audits.push(data);
        return data;
      }),
    },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));
vi.mock("@/server/auth/login-sources", () => ({
  isKnownLoginSource: vi.fn(async () => false),
}));

import { POST as precheck } from "@/app/api/crm/auth/totp-required/route";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";

const post = (email: string, password: string) =>
  precheck(
    new Request("https://neurofax.uz/api/crm/auth/totp-required", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "198.51.100.20",
        "user-agent": "Safari/18",
      },
      body: JSON.stringify({ email, password }),
    }),
  );

beforeEach(async () => {
  __resetRateLimitsForTests();
  h.audits = [];
  h.users.clear();
  h.users.set("nurse@x.uz", {
    id: "u7",
    email: "nurse@x.uz",
    role: "NURSE",
    clinicId: "c1",
    active: true,
    totpEnabledAt: null,
    passwordHash: await bcrypt.hash("right", 4),
  });
});

describe("the login form's password check is audited", () => {
  it("a wrong password is a LOGIN_FAILED row with IP and agent", async () => {
    expect((await post("nurse@x.uz", "wrong")).status).toBe(401);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "LOGIN_FAILED",
        clinicId: "c1",
        entityId: "u7",
        actorId: null,
        actorLabel: "nurse@x.uz",
        meta: { reason: "bad_password", stage: "precheck" },
        ip: "198.51.100.20",
        userAgent: "Safari/18",
      }),
    ]);
  });

  it("an unknown email too, without a clinic; a right password writes nothing here", async () => {
    await post("who@x.uz", "x");
    expect((await post("nurse@x.uz", "right")).status).toBe(200);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "LOGIN_FAILED",
        clinicId: null,
        entityId: null,
        meta: { reason: "unknown_user", stage: "precheck" },
      }),
    ]);
  });

  it("a guessing run shows up, the lockout included", async () => {
    for (let i = 0; i < 6; i++) await post("nurse@x.uz", `guess-${i}`);
    const reasons = h.audits.map((a) => (a.meta as { reason: string }).reason);
    expect(reasons.filter((r) => r === "bad_password").length).toBe(5);
    expect(reasons.at(-1)).toBe("throttled");
  });
});
