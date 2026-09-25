import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

/**
 * Audit SEC-02 / SEC-03 — login brute force and the rate limiter itself.
 *
 *   - the 2FA pre-flight (/api/crm/auth/totp-required) and the NextAuth
 *     credentials callback share one failed-attempt budget: the 6th wrong
 *     password for one email within 15 minutes gets 429 on both;
 *   - the bucket is the real peer (X-Real-IP from nginx), so a spoofed
 *     X-Forwarded-For lands in the same bucket;
 *   - successful sign-ins, sign-out and session refreshes never spend it;
 *   - an unknown email costs the same bcrypt work as a known one;
 *   - the limiter's memory is bounded however many distinct keys arrive.
 */

const h = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  handlerPost: vi.fn(async () => Response.json({ url: "https://x/crm" })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => h.users.get(where.email) ?? null),
    },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));
vi.mock("@/lib/auth", () => ({
  handlers: { GET: vi.fn(), POST: h.handlerPost },
}));

import {
  MAX_KEYS_PER_STORE,
  __resetRateLimitsForTests,
  rateLimit,
  recordFailure,
  storeSize,
} from "@/lib/rate-limit";
import {
  LOGIN_FAILURE_LIMITS,
  LOGIN_FAILURE_WINDOW_MS,
  checkLoginThrottle,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/server/auth/login-throttle";
import { realClientIp } from "@/lib/client-ip";
import { POST as totpRequired } from "@/app/api/crm/auth/totp-required/route";
import { POST as nextAuthPost } from "@/app/api/auth/[...nextauth]/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  __resetRateLimitsForTests();
  h.users.clear();
  h.handlerPost.mockClear();
  delete process.env.DISABLE_AUTH_RATE_LIMIT;
});

function preflight(email: string, password: string, headers: Record<string, string> = {}) {
  return totpRequired(
    new Request("https://neurofax.uz/api/crm/auth/totp-required", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "198.51.100.20", ...headers },
      body: JSON.stringify({ email, password }),
    }),
  );
}

function credentialsCallback(email: string, headers: Record<string, string> = {}) {
  return nextAuthPost(
    new NextRequest("https://neurofax.uz/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-real-ip": "198.51.100.20",
        ...headers,
      },
      body: new URLSearchParams({ email, password: "x", csrfToken: "t" }).toString(),
    }),
  );
}

describe("login throttle policy", () => {
  const who = { ip: "203.0.113.5", email: "Doc@X.uz" };

  it("blocks the 6th failed attempt for one email from one address, for the rest of the window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.emailIp; i++) {
      expect(checkLoginThrottle(who, t0).blocked).toBe(false);
      recordLoginFailure(who, t0);
    }
    const s = checkLoginThrottle(who, t0 + 1000);
    expect(s.blocked).toBe(true);
    expect(s.retryAfterSec).toBeGreaterThan(0);
    expect(s.retryAfterSec).toBeLessThanOrEqual(LOGIN_FAILURE_WINDOW_MS / 1000);
    // Email matching is case-insensitive.
    expect(checkLoginThrottle({ ip: who.ip, email: "doc@x.uz" }, t0 + 1000).blocked).toBe(true);
    // ...and the lock lifts when the window has passed.
    expect(checkLoginThrottle(who, t0 + LOGIN_FAILURE_WINDOW_MS + 1).blocked).toBe(false);
  });

  it("a colleague on the same office IP is not locked out by someone else's typos", () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.emailIp; i++) recordLoginFailure(who);
    expect(checkLoginThrottle({ ip: who.ip, email: "recept@x.uz" }).blocked).toBe(false);
  });

  it("one address spraying many accounts is stopped by the per-IP budget", () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.ip; i++) {
      recordLoginFailure({ ip: "203.0.113.66", email: `u${i}@x.uz` });
    }
    expect(checkLoginThrottle({ ip: "203.0.113.66", email: "new@x.uz" }).blocked).toBe(true);
  });

  it("a successful sign-in clears the email's failures", () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.emailIp - 1; i++) recordLoginFailure(who);
    recordLoginSuccess(who);
    recordLoginFailure(who);
    expect(checkLoginThrottle(who).blocked).toBe(false);
  });

  it("DISABLE_AUTH_RATE_LIMIT turns it off for e2e", () => {
    process.env.DISABLE_AUTH_RATE_LIMIT = "1";
    for (let i = 0; i < 20; i++) recordLoginFailure(who);
    expect(checkLoginThrottle(who).blocked).toBe(false);
  });
});

describe("real client IP", () => {
  it("a spoofed X-Forwarded-For does not change the bucket", () => {
    const plain = new Request("https://x", { headers: { "x-real-ip": "198.51.100.1" } });
    const spoofed = new Request("https://x", {
      headers: { "x-real-ip": "198.51.100.1", "x-forwarded-for": "6.6.6.6, 198.51.100.1" },
    });
    expect(realClientIp(spoofed)).toBe(realClientIp(plain));
  });
});

describe("POST /api/crm/auth/totp-required", () => {
  beforeEach(async () => {
    h.users.set("doc@x.uz", {
      id: "u1",
      passwordHash: await bcrypt.hash("right-password", 4),
      active: true,
      totpEnabledAt: null,
    });
  });

  it("answers 429 on the 6th wrong password, and so does the credentials callback", async () => {
    for (let i = 0; i < 5; i++) {
      // A fresh spoofed X-Forwarded-For every time changes nothing.
      const r = await preflight("doc@x.uz", `wrong-${i}`, { "x-forwarded-for": `10.9.8.${i}` });
      expect(r.status).toBe(401);
    }
    const sixth = await preflight("doc@x.uz", "right-password", { "x-forwarded-for": "10.9.8.77" });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).toBeTruthy();

    const cb = await credentialsCallback("doc@x.uz");
    expect(cb.status).toBe(429);
    // next-auth/react parses `url` out of the body; it must be present or the
    // login button stays stuck on «Входим…».
    const body = (await cb.json()) as { url: string };
    expect(new URL(body.url).searchParams.get("error")).toBe("RateLimited");
    expect(h.handlerPost).not.toHaveBeenCalled();
  });

  it("spends a bcrypt comparison on an unknown email too (no timing oracle)", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    const r = await preflight("nobody@x.uz", "whatever");
    expect(r.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("the right password still answers 200", async () => {
    const r = await preflight("doc@x.uz", "right-password");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ requiresTotp: false });
  });
});

describe("POST /api/auth/* is never throttled outside the credentials callback", () => {
  it("sign-out and session refresh pass even while the address is locked", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.ip + 5; i++) {
      recordLoginFailure({ ip: "198.51.100.20", email: `x${i}@x.uz` });
    }
    for (const path of ["signout", "session"]) {
      const r = await nextAuthPost(
        new NextRequest(`https://neurofax.uz/api/auth/${path}`, {
          method: "POST",
          headers: { "x-real-ip": "198.51.100.20" },
        }),
      );
      expect(r.status).toBe(200);
    }
    expect(h.handlerPost).toHaveBeenCalledTimes(2);
  });

  it("ten successful sign-ins from one office IP in a minute all reach NextAuth", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await credentialsCallback(`staff${i}@x.uz`);
      expect(r.status).toBe(200);
    }
    expect(h.handlerPost).toHaveBeenCalledTimes(10);
  });
});

describe("rate-limit store", () => {
  it("keeps its fixed-window semantics", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000, "t")).toBe(true);
    expect(rateLimit("k", 3, 60_000, "t")).toBe(false);
  });

  it("does not grow without bound on 100k distinct keys", () => {
    const now = Date.now();
    for (let i = 0; i < 100_000; i++) recordFailure("flood", `k${i}`, 60_000, now);
    expect(storeSize("flood")).toBeLessThanOrEqual(MAX_KEYS_PER_STORE);
  });

  it("a flood in one store does not evict another store's counters", () => {
    recordLoginFailure({ ip: "1.1.1.1", email: "a@x.uz" });
    for (let i = 0; i < 50_000; i++) rateLimit(`lead:${i}`, 10, 60_000, "leads");
    expect(storeSize("login-failures")).toBeGreaterThan(0);
  });
});
