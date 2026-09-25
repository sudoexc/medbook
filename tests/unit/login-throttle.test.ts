import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

/**
 * Audit SEC-02 / SEC-03 — login brute force and the rate limiter itself.
 *
 *   - the 2FA pre-flight (/api/crm/auth/totp-required) and the NextAuth
 *     credentials callback share one failed-attempt budget: the 6th wrong
 *     password for one email within 15 minutes gets 429 on both;
 *   - the slot is taken BEFORE bcrypt, so a burst of parallel requests gets
 *     5 password checks, not one per request (review of 4308b0f);
 *   - the account-wide and per-address buckets do not lock the owner out of
 *     an address she signed in from before (review of 4308b0f);
 *   - the bucket is the real peer (X-Real-IP from nginx, IPv6 by /64), so a
 *     spoofed X-Forwarded-For lands in the same bucket;
 *   - successful sign-ins, sign-out and session refreshes never spend it;
 *   - an unknown email costs the same bcrypt work as a known one;
 *   - the limiter's memory is bounded however many distinct keys arrive.
 */

const h = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  known: new Set<string>(),
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
vi.mock("@/server/auth/login-sources", () => ({
  isKnownLoginSource: vi.fn(async (email: string | null, ip: string) => h.known.has(`${email}|${ip}`)),
}));

import {
  MAX_KEYS_PER_STORE,
  __resetRateLimitsForTests,
  rateLimit,
  recordFailure,
  refundFailure,
  failureCount,
  storeSize,
} from "@/lib/rate-limit";
import {
  LOGIN_FAILURE_LIMITS,
  LOGIN_FAILURE_WINDOW_MS,
  beginLoginAttempt,
  checkLoginThrottle,
  recordLoginFailure,
} from "@/server/auth/login-throttle";
import { ipBucket, realClientIp } from "@/lib/client-ip";
import { POST as totpRequired } from "@/app/api/crm/auth/totp-required/route";
import { POST as nextAuthPost } from "@/app/api/auth/[...nextauth]/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  __resetRateLimitsForTests();
  h.users.clear();
  h.known.clear();
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

/** A known-source lookup that says yes, and records that it was asked. */
function knownSource() {
  return vi.fn(async () => true);
}

describe("login throttle policy", () => {
  const who = { ip: "203.0.113.5", email: "Doc@X.uz" };

  it("blocks the 6th failed attempt for one email from one address, for the rest of the window", async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.emailIp; i++) {
      const a = await beginLoginAttempt(who, { now: t0 });
      expect(a.blocked).toBe(false);
      // Never settled: the slot stays a failure.
    }
    const s = await checkLoginThrottle(who, { now: t0 + 1000 });
    expect(s.blocked).toBe(true);
    expect(s.retryAfterSec).toBeGreaterThan(0);
    expect(s.retryAfterSec).toBeLessThanOrEqual(LOGIN_FAILURE_WINDOW_MS / 1000);
    expect((await beginLoginAttempt(who, { now: t0 + 1000 })).blocked).toBe(true);
    // Email matching is case-insensitive.
    expect((await checkLoginThrottle({ ip: who.ip, email: "doc@x.uz" }, { now: t0 + 1000 })).blocked).toBe(true);
    // ...and the lock lifts when the window has passed.
    expect((await checkLoginThrottle(who, { now: t0 + LOGIN_FAILURE_WINDOW_MS + 1 })).blocked).toBe(false);
  });

  it("a burst of parallel attempts gets exactly 5 slots, not one each", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 200 }, () => beginLoginAttempt(who)),
    );
    expect(attempts.filter((a) => !a.blocked)).toHaveLength(LOGIN_FAILURE_LIMITS.emailIp);
  });

  it("a colleague on the same office IP is not locked out by someone else's typos", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.emailIp; i++) recordLoginFailure(who);
    expect((await checkLoginThrottle({ ip: who.ip, email: "recept@x.uz" })).blocked).toBe(false);
  });

  it("one address spraying many accounts is stopped by the per-IP budget", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.ip; i++) {
      recordLoginFailure({ ip: "203.0.113.66", email: `u${i}@x.uz` });
    }
    expect((await checkLoginThrottle({ ip: "203.0.113.66", email: "new@x.uz" })).blocked).toBe(true);
  });

  it("a successful sign-in clears this address's failures for the account", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.emailIp - 1; i++) recordLoginFailure(who);
    const ok = await beginLoginAttempt(who);
    if (ok.blocked) throw new Error("unexpected block");
    ok.succeeded();
    recordLoginFailure(who);
    expect((await checkLoginThrottle(who)).blocked).toBe(false);
  });

  it("successes and released attempts give their slots back; forgotten ones stay failures", async () => {
    const t = 5_000_000;
    const a = await beginLoginAttempt(who, { now: t });
    const b = await beginLoginAttempt(who, { now: t });
    const c = await beginLoginAttempt(who, { now: t });
    if (a.blocked || b.blocked || c.blocked) throw new Error("unexpected block");
    a.succeeded();
    b.release();
    b.release(); // settling twice changes nothing
    // Only `c` (never settled) is left: one failure, per address and per account.
    expect(failureCount("login-failures", "ip:203.0.113.5", t).count).toBe(1);
    expect(failureCount("login-failures", "e:doc@x.uz", t).count).toBe(1);
  });

  it("the victim's own sign-in does not hand an attacker a fresh account-wide budget", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.email; i++) {
      recordLoginFailure({ ip: `192.0.2.${i}`, email: "doc@x.uz" });
    }
    const mine = await beginLoginAttempt({ ip: "203.0.113.5", email: "doc@x.uz" }, { isKnownSource: knownSource() });
    if (mine.blocked) throw new Error("owner should get in from a known source");
    mine.succeeded();
    // A stranger's address is still refused.
    expect((await checkLoginThrottle({ ip: "192.0.2.200", email: "doc@x.uz" })).blocked).toBe(true);
  });

  it("DISABLE_AUTH_RATE_LIMIT turns it off for e2e", async () => {
    process.env.DISABLE_AUTH_RATE_LIMIT = "1";
    for (let i = 0; i < 20; i++) recordLoginFailure(who);
    expect((await checkLoginThrottle(who)).blocked).toBe(false);
    expect((await beginLoginAttempt(who)).blocked).toBe(false);
  });
});

describe("an outsider cannot lock the owner out (review of 4308b0f)", () => {
  const doctor = "busakov@neurofax.uz";
  const clinicIp = "203.0.113.10";

  function fillAccountBucket() {
    // 25 wrong passwords from each of two addresses: under the per-IP cap,
    // enough to fill the account-wide bucket.
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.email; i++) {
      recordLoginFailure({ ip: i % 2 ? "198.51.100.1" : "198.51.100.2", email: doctor });
    }
  }

  it("a full account-wide bucket does not block an address the doctor signed in from", async () => {
    fillAccountBucket();
    const isKnownSource = knownSource();
    expect((await checkLoginThrottle({ ip: clinicIp, email: doctor }, { isKnownSource })).blocked).toBe(false);
    expect(isKnownSource).toHaveBeenCalled();
    // A new address for this account is still refused.
    expect(
      (await checkLoginThrottle({ ip: "192.0.2.77", email: doctor }, { isKnownSource: async () => false })).blocked,
    ).toBe(true);
  });

  it("a guest filling the clinic's per-IP bucket does not block staff who sign in there", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.ip; i++) {
      recordLoginFailure({ ip: clinicIp, email: `guess${i}@neurofax.uz` });
    }
    expect((await beginLoginAttempt({ ip: clinicIp, email: doctor }, { isKnownSource: knownSource() })).blocked).toBe(false);
    expect(
      (await beginLoginAttempt({ ip: clinicIp, email: "never-here@neurofax.uz" }, { isKnownSource: async () => false })).blocked,
    ).toBe(true);
  });

  it("the email + address bucket still blocks, known source or not", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.emailIp; i++) recordLoginFailure({ ip: clinicIp, email: doctor });
    const isKnownSource = knownSource();
    expect((await beginLoginAttempt({ ip: clinicIp, email: doctor }, { isKnownSource })).blocked).toBe(true);
    // No reason to ask when the answer cannot change the verdict.
    expect(isKnownSource).not.toHaveBeenCalled();
  });

  it("a normal sign-in never asks whether the address is known", async () => {
    const isKnownSource = knownSource();
    await beginLoginAttempt({ ip: clinicIp, email: doctor }, { isKnownSource });
    expect(isKnownSource).not.toHaveBeenCalled();
  });

  it("a failing lookup treats the address as a stranger", async () => {
    fillAccountBucket();
    const s = await checkLoginThrottle(
      { ip: clinicIp, email: doctor },
      { isKnownSource: async () => { throw new Error("db down"); } },
    );
    expect(s.blocked).toBe(true);
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

  it("IPv6 addresses are bucketed by /64, IPv4 as is", () => {
    expect(ipBucket("203.0.113.9")).toBe("203.0.113.9");
    expect(ipBucket("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:DB8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipBucket("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
    expect(ipBucket("2001:db8:1:2:3:4:5:6")).not.toBe(ipBucket("2001:db8:1:3:3:4:5:6"));
    expect(ipBucket("unknown")).toBe("unknown");
    expect(ipBucket("1:2:3")).toBe("1:2:3");
  });

  it("walking through one /64 does not buy fresh attempts", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.emailIp; i++) {
      recordLoginFailure({ ip: `2001:db8:1:2::${(i + 1).toString(16)}`, email: "doc@x.uz" });
    }
    expect((await checkLoginThrottle({ ip: "2001:db8:1:2:ffff::9", email: "doc@x.uz" })).blocked).toBe(true);
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

  it("500 parallel guesses get 5 bcrypt checks, and the right password among them is not confirmed", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    const guesses = Array.from({ length: 500 }, (_, i) => (i === 250 ? "right-password" : `guess-${i}`));
    const responses = await Promise.all(guesses.map((p) => preflight("doc@x.uz", p)));
    expect(spy).toHaveBeenCalledTimes(LOGIN_FAILURE_LIMITS.emailIp);
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(LOGIN_FAILURE_LIMITS.emailIp);
    expect(statuses.filter((s) => s === 429)).toHaveLength(500 - LOGIN_FAILURE_LIMITS.emailIp);
    expect(responses[250]!.status).toBe(429);
    spy.mockRestore();
  });

  it("spends a bcrypt comparison on an unknown email too (no timing oracle)", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    const r = await preflight("nobody@x.uz", "whatever");
    expect(r.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("the right password still answers 200, and does not spend the budget", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await preflight("doc@x.uz", "right-password");
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ requiresTotp: false });
    }
    expect(failureCount("login-failures", "ip:198.51.100.20").count).toBe(0);
  });

  it("the owner gets in from a known address while strangers have filled her account-wide bucket", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMITS.email; i++) {
      recordLoginFailure({ ip: `192.0.2.${i}`, email: "doc@x.uz" });
    }
    expect((await preflight("doc@x.uz", "right-password")).status).toBe(429);
    h.known.add("doc@x.uz|198.51.100.20");
    expect((await preflight("doc@x.uz", "right-password")).status).toBe(200);
    expect((await credentialsCallback("doc@x.uz")).status).toBe(200);
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

  it("a refund only ever gives back a failure from the same window", () => {
    const t = 1_000;
    recordFailure("r", "k", 60_000, t);
    recordFailure("r", "k", 60_000, t);
    const { resetAt } = failureCount("r", "k", t);
    refundFailure("r", "k", resetAt - 1, t); // some other window: ignored
    expect(failureCount("r", "k", t).count).toBe(2);
    refundFailure("r", "k", resetAt, t);
    expect(failureCount("r", "k", t).count).toBe(1);
    refundFailure("r", "k", resetAt, t);
    expect(storeSize("r")).toBe(0);
  });
});
