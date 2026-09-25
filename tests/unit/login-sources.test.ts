import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Review of 4308b0f (SEC-02): the throttle's account-wide and per-address
 * buckets must not lock an account out of an address it signs in from. That
 * memory lives in StaffLoginSource so a restart does not forget it while an
 * attacker keeps the buckets full.
 */

const h = vi.hoisted(() => ({
  rows: [] as Array<{ userId: string; source: string; lastSuccessAt: Date; email: string }>,
  emails: new Map<string, string>(),
  findFirst: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  fail: false,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    staffLoginSource: {
      findFirst: h.findFirst,
      upsert: h.upsert,
      deleteMany: h.deleteMany,
    },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
}));

import {
  KNOWN_SOURCE_TTL_MS,
  __resetLoginSourceMemoForTests,
  isKnownLoginSource,
  rememberLoginSource,
} from "@/server/auth/login-sources";

type Where = { source: string; lastSuccessAt: { gte: Date }; user: { email: string } };

beforeEach(() => {
  __resetLoginSourceMemoForTests();
  h.rows = [];
  h.fail = false;
  h.findFirst.mockReset();
  h.findFirst.mockImplementation(async ({ where }: { where: Where }) => {
    if (h.fail) throw new Error("db down");
    return (
      h.rows.find(
        (r) =>
          r.source === where.source &&
          r.email === where.user.email &&
          r.lastSuccessAt >= where.lastSuccessAt.gte,
      ) ?? null
    );
  });
  h.upsert.mockReset();
  h.upsert.mockImplementation(
    async (args: { create: { userId: string; source: string; lastSuccessAt: Date } }) => {
      h.rows.push({ ...args.create, email: h.emails.get(args.create.userId) ?? "" });
      return args.create;
    },
  );
  h.deleteMany.mockReset();
  h.deleteMany.mockResolvedValue({ count: 0 });
  h.emails.set("u1", "doc@x.uz");
});

describe("login sources", () => {
  it("a completed sign-in makes its address known for this account only", async () => {
    await rememberLoginSource({ userId: "u1", email: "doc@x.uz", ip: "203.0.113.10" });
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_source: { userId: "u1", source: "203.0.113.10" } } }),
    );
    __resetLoginSourceMemoForTests();
    expect(await isKnownLoginSource("doc@x.uz", "203.0.113.10")).toBe(true);
    expect(await isKnownLoginSource("doc@x.uz", "203.0.113.11")).toBe(false);
    expect(await isKnownLoginSource("other@x.uz", "203.0.113.10")).toBe(false);
  });

  it("an IPv6 sign-in trusts its /64, not one address of it", async () => {
    await rememberLoginSource({ userId: "u1", email: "doc@x.uz", ip: "2001:db8:1:2::abcd" });
    __resetLoginSourceMemoForTests();
    expect(await isKnownLoginSource("doc@x.uz", "2001:db8:1:2:ffff::1")).toBe(true);
    expect(await isKnownLoginSource("doc@x.uz", "2001:db8:1:3::abcd")).toBe(false);
  });

  it("only the last 30 days count, and old rows are pruned on the next sign-in", async () => {
    const now = Date.now();
    h.rows.push({
      userId: "u1",
      source: "203.0.113.10",
      email: "doc@x.uz",
      lastSuccessAt: new Date(now - KNOWN_SOURCE_TTL_MS - 1000),
    });
    expect(await isKnownLoginSource("doc@x.uz", "203.0.113.10", now)).toBe(false);
    await rememberLoginSource({ userId: "u1", email: "doc@x.uz", ip: "198.51.100.1", now: new Date(now) });
    expect(h.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", lastSuccessAt: { lt: new Date(now - KNOWN_SOURCE_TTL_MS) } },
    });
  });

  it("no peer address, no trust: an 'unknown' source is never remembered or matched", async () => {
    await rememberLoginSource({ userId: "u1", email: "doc@x.uz", ip: "unknown" });
    expect(h.upsert).not.toHaveBeenCalled();
    expect(await isKnownLoginSource("doc@x.uz", "unknown")).toBe(false);
    expect(await isKnownLoginSource(null, "203.0.113.10")).toBe(false);
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it("asks the database at most once a minute per (email, address)", async () => {
    for (let i = 0; i < 20; i++) await isKnownLoginSource("doc@x.uz", "192.0.2.1");
    expect(h.findFirst).toHaveBeenCalledTimes(1);
  });

  it("a failing database means 'not known', is not remembered, and never breaks sign-in", async () => {
    h.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await isKnownLoginSource("doc@x.uz", "192.0.2.1")).toBe(false);
    h.fail = false;
    h.rows.push({ userId: "u1", source: "192.0.2.1", email: "doc@x.uz", lastSuccessAt: new Date() });
    expect(await isKnownLoginSource("doc@x.uz", "192.0.2.1")).toBe(true);
    h.upsert.mockRejectedValueOnce(new Error("db down"));
    await expect(
      rememberLoginSource({ userId: "u1", email: "doc@x.uz", ip: "192.0.2.9" }),
    ).resolves.toBeUndefined();
  });
});
