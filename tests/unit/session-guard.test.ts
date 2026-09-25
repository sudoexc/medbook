import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit SEC-05 / SEC-06 / SEC-07 / DC-02 — the staff session guard.
 *
 * The NextAuth `jwt` callback asks this module on every `auth()` call, so its
 * verdict is what pages, layouts, every /api route and the proxy see. These
 * tests pin the acceptance scenarios of the cards:
 *   - a JWT with no live UserSession behind it is refused (the old "legacy
 *     one-time pass" let a kicked or idled-out browser straight back in);
 *   - a deactivated or moved account is refused on the next request; a
 *     demoted one keeps its session but with the NEW role;
 *   - idle and the 8h cap apply everywhere; a user who keeps clicking or
 *     typing (the input heartbeat) is never timed out, while a page that only
 *     polls on its own (the live queue screen) no longer keeps an abandoned
 *     PC signed in;
 *   - revoking sessions (password reset/change, deactivation) cuts every open
 *     browser off at the next request.
 */

const state = vi.hoisted(() => ({
  rows: new Map<
    string,
    { id: string; userId: string; tokenHash: string; createdAt: Date; lastActivityAt: Date }
  >(),
  users: new Map<
    string,
    {
      id: string;
      active: boolean;
      role: string;
      clinicId: string | null;
      mustChangePassword: boolean;
      lastSessionRotatedAt: Date | null;
      clinic: { sessionIdleTimeoutMinutes: number } | null;
    }
  >(),
  fail: false,
  updates: [] as Array<{ id: string; lastActivityAt: Date }>,
  deletes: [] as string[],
  audits: [] as Array<{ action: string; entityId: string }>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userSession: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; tokenHash?: string } }) => {
        if (state.fail) throw new Error("db down");
        const all = [...state.rows.values()];
        const row = where.id
          ? state.rows.get(where.id)
          : all.find((r) => r.tokenHash === where.tokenHash);
        return row
          ? { id: row.id, userId: row.userId, createdAt: row.createdAt, lastActivityAt: row.lastActivityAt }
          : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { lastActivityAt: Date } }) => {
        state.updates.push({ id: where.id, lastActivityAt: data.lastActivityAt });
        const row = state.rows.get(where.id);
        if (row) row.lastActivityAt = data.lastActivityAt;
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        state.deletes.push(where.id);
        state.rows.delete(where.id);
        return {};
      }),
      deleteMany: vi.fn(async ({ where }: { where: { userId?: string; id?: string | { not: string } } }) => {
        let count = 0;
        for (const [id, row] of state.rows) {
          if (where.userId && row.userId !== where.userId) continue;
          if (typeof where.id === "string" && id !== where.id) continue;
          if (where.id && typeof where.id === "object" && id === where.id.not) continue;
          state.rows.delete(id);
          count++;
        }
        return { count };
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (state.fail) throw new Error("db down");
        return state.users.get(where.id) ?? null;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: { action: string; entityId: string } }) => {
        state.audits.push({ action: data.action, entityId: data.entityId });
        return {};
      }),
    },
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => Promise.resolve(fn()),
}));

import {
  decideStaffSession,
  evaluateStaffSession,
  invalidateSessionGuardCache,
  revokeUserSessions,
  type GuardRow,
  type GuardUser,
} from "@/server/auth/session-guard";

const MIN = 60_000;
const NOW = new Date("2026-09-25T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function user(over: Partial<GuardUser> = {}): GuardUser {
  return {
    id: "u1",
    active: true,
    role: "RECEPTIONIST",
    clinicId: "c1",
    mustChangePassword: false,
    lastSessionRotatedAt: ago(60 * MIN),
    idleTimeoutMinutes: 30,
    ...over,
  };
}
function row(over: Partial<GuardRow> = {}): GuardRow {
  return {
    id: "s1",
    userId: "u1",
    createdAt: ago(60 * MIN),
    lastActivityAt: ago(2 * MIN),
    ...over,
  };
}
const claims = { userId: "u1", role: "RECEPTIONIST" as const, clinicId: "c1" };
const sid = { kind: "sid" as const, sessionId: "s1" };

describe("decideStaffSession", () => {
  it("accepts a live session and hands back the current account claims", () => {
    const v = decideStaffSession({ claims, binding: sid, row: row(), user: user(), now: NOW });
    expect(v).toEqual({
      ok: true,
      sessionId: "s1",
      fresh: { role: "RECEPTIONIST", clinicId: "c1", mustChangePassword: false },
    });
  });

  it("refuses a JWT with neither a session id nor a session cookie (no more legacy pass)", () => {
    const v = decideStaffSession({ claims, binding: { kind: "none" }, row: null, user: user(), now: NOW });
    expect(v).toMatchObject({ ok: false, reason: "expired" });
  });

  it("refuses when the session row is gone: kicked by a newer login, signed out, revoked", () => {
    const v = decideStaffSession({ claims, binding: sid, row: null, user: user(), now: NOW });
    expect(v).toMatchObject({ ok: false, reason: "expired" });
  });

  it("refuses a session row that belongs to somebody else", () => {
    const v = decideStaffSession({
      claims,
      binding: sid,
      row: row({ userId: "someone-else" }),
      user: user(),
      now: NOW,
    });
    expect(v).toMatchObject({ ok: false, reason: "expired" });
  });

  it("refuses a deactivated or deleted account (SEC-05)", () => {
    expect(
      decideStaffSession({ claims, binding: sid, row: row(), user: user({ active: false }), now: NOW }),
    ).toMatchObject({ ok: false, reason: "inactive" });
    expect(
      decideStaffSession({ claims, binding: sid, row: row(), user: null, now: NOW }),
    ).toMatchObject({ ok: false, reason: "inactive" });
  });

  it("refuses an account moved to another clinic (SEC-05)", () => {
    const v = decideStaffSession({ claims, binding: sid, row: row(), user: user({ clinicId: "c2" }), now: NOW });
    expect(v).toMatchObject({ ok: false, reason: "moved" });
  });

  it("keeps a demoted account signed in, with the NEW role (403 on admin APIs, no re-login)", () => {
    const v = decideStaffSession({
      claims: { ...claims, role: "ADMIN" },
      binding: sid,
      row: row(),
      user: user({ role: "RECEPTIONIST" }),
      now: NOW,
    });
    expect(v).toMatchObject({ ok: true, fresh: { role: "RECEPTIONIST" } });
  });

  it("refuses a move between the platform and a clinic role", () => {
    const v = decideStaffSession({
      claims: { userId: "u1", role: "SUPER_ADMIN", clinicId: null },
      binding: sid,
      row: row(),
      user: user({ role: "ADMIN" }),
      now: NOW,
    });
    expect(v).toMatchObject({ ok: false, reason: "moved" });
  });

  it("does not compare the clinic of a SUPER_ADMIN (impersonation sets it)", () => {
    const v = decideStaffSession({
      claims: { userId: "u1", role: "SUPER_ADMIN", clinicId: "impersonated" },
      binding: sid,
      row: row(),
      user: user({ role: "SUPER_ADMIN", clinicId: null }),
      now: NOW,
    });
    expect(v.ok).toBe(true);
  });

  it("times out after the clinic's idle window", () => {
    const v = decideStaffSession({
      claims,
      binding: sid,
      row: row({ lastActivityAt: ago(31 * MIN) }),
      user: user({ idleTimeoutMinutes: 30 }),
      now: NOW,
    });
    expect(v).toMatchObject({ ok: false, reason: "idle", sessionId: "s1" });
  });

  it("ends every session 8h after sign-in, however active", () => {
    const v = decideStaffSession({
      claims,
      binding: sid,
      row: row({ createdAt: ago(8 * 60 * MIN + MIN), lastActivityAt: ago(10_000) }),
      user: user({ lastSessionRotatedAt: ago(8 * 60 * MIN + MIN) }),
      now: NOW,
    });
    expect(v).toMatchObject({ ok: false, reason: "forced-rerotate" });
  });

  it("gives pre-deploy (cookie-bound) sessions an idle clock that starts at process start", () => {
    const staleRow = row({ lastActivityAt: ago(3 * 60 * MIN) });
    const cookie = { kind: "cookie" as const, tokenHash: "h" };
    expect(
      decideStaffSession({ claims, binding: cookie, row: staleRow, user: user(), now: NOW, legacyIdleFloor: ago(5 * MIN) }),
    ).toMatchObject({ ok: true });
    // A session minted after the deploy gets no such grace.
    expect(
      decideStaffSession({ claims, binding: sid, row: staleRow, user: user(), now: NOW, legacyIdleFloor: ago(5 * MIN) }),
    ).toMatchObject({ ok: false, reason: "idle" });
  });

  it("an unbound session (row minting failed at sign-in) is not locked out, but account checks still run", () => {
    expect(
      decideStaffSession({ claims, binding: { kind: "unbound" }, row: null, user: user(), now: NOW }),
    ).toMatchObject({ ok: true });
    expect(
      decideStaffSession({ claims, binding: { kind: "unbound" }, row: null, user: user({ active: false }), now: NOW }),
    ).toMatchObject({ ok: false, reason: "inactive" });
  });
});

describe("evaluateStaffSession", () => {
  beforeEach(() => {
    state.rows.clear();
    state.users.clear();
    state.fail = false;
    state.updates = [];
    state.deletes = [];
    state.audits = [];
    invalidateSessionGuardCache();
    state.users.set("u1", {
      id: "u1",
      active: true,
      role: "RECEPTIONIST",
      clinicId: "c1",
      mustChangePassword: false,
      lastSessionRotatedAt: ago(60 * MIN),
      clinic: { sessionIdleTimeoutMinutes: 30 },
    });
    state.rows.set("s1", {
      id: "s1",
      userId: "u1",
      tokenHash: "h1",
      createdAt: ago(60 * MIN),
      lastActivityAt: ago(5 * MIN),
    });
  });

  it("a user working 40 minutes on one page (input heartbeats, no navigation) is never timed out", async () => {
    // The page polls every 15 s; the person clicks or types, so a heartbeat
    // goes out once a minute.
    for (let s = 0; s <= 40 * 60; s += 15) {
      const at = new Date(NOW.getTime() + s * 1000);
      const v = await evaluateStaffSession({ claims, binding: sid, now: at, countAsActivity: s % 60 === 0 });
      expect(v.ok).toBe(true);
    }
    // ...and the activity writes were throttled, not one per request.
    expect(state.updates.length).toBeGreaterThan(0);
    expect(state.updates.length).toBeLessThanOrEqual(41);
  });

  it("an abandoned reception PC times out even though its queue page keeps polling (review of 4308b0f)", async () => {
    // Last touched 5 minutes before NOW, then only the page's own polling.
    let kicked: Awaited<ReturnType<typeof evaluateStaffSession>> | null = null;
    let kickedAtMin = -1;
    for (let s = 0; s <= 60 * 60 && !kicked; s += 15) {
      const at = new Date(NOW.getTime() + s * 1000);
      const v = await evaluateStaffSession({ claims, binding: sid, now: at });
      if (!v.ok) {
        kicked = v;
        kickedAtMin = s / 60;
      }
    }
    expect(kicked).toMatchObject({ ok: false, reason: "idle" });
    // 30-minute idle window, last activity 5 minutes before the polling began.
    expect(kickedAtMin).toBeGreaterThan(24);
    expect(kickedAtMin).toBeLessThanOrEqual(26);
    expect(state.updates).toHaveLength(0);
  });

  it("does not bump activity for server-side re-checks (an open SSE stream)", async () => {
    await evaluateStaffSession({ claims, binding: sid, now: NOW, countAsActivity: false });
    expect(state.updates).toHaveLength(0);
  });

  it("an idled-out session is deleted and audited, and stays dead", async () => {
    state.rows.get("s1")!.lastActivityAt = ago(45 * MIN);
    const v = await evaluateStaffSession({ claims, binding: sid, now: NOW });
    expect(v).toMatchObject({ ok: false, reason: "idle" });
    await new Promise((r) => setTimeout(r, 0));
    expect(state.deletes).toContain("s1");
    expect(state.audits.map((a) => a.action)).toContain("SESSION_TIMEOUT_LOGOUT");
    // Coming back (Back button, bookmark) finds no row: still refused.
    const again = await evaluateStaffSession({ claims, binding: sid, now: NOW });
    expect(again).toMatchObject({ ok: false, reason: "expired" });
  });

  it("deactivation is noticed within the cache window (well under 60s)", async () => {
    expect((await evaluateStaffSession({ claims, binding: sid, now: NOW })).ok).toBe(true);
    state.users.get("u1")!.active = false;
    const later = new Date(NOW.getTime() + 11_000);
    expect(await evaluateStaffSession({ claims, binding: sid, now: later })).toMatchObject({
      ok: false,
      reason: "inactive",
    });
  });

  it("revoking a user's sessions cuts off the open browser at the next request", async () => {
    expect((await evaluateStaffSession({ claims, binding: sid, now: NOW })).ok).toBe(true);
    const n = await revokeUserSessions("u1");
    expect(n).toBe(1);
    expect(await evaluateStaffSession({ claims, binding: sid, now: NOW })).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });

  it("revoking can spare the caller's own session (password changed by the user)", async () => {
    state.rows.set("s2", {
      id: "s2",
      userId: "u1",
      tokenHash: "h2",
      createdAt: ago(10 * MIN),
      lastActivityAt: ago(MIN),
    });
    await revokeUserSessions("u1", { exceptSessionId: "s2" });
    expect([...state.rows.keys()]).toEqual(["s2"]);
  });

  it("a database error fails open instead of logging the clinic out", async () => {
    state.fail = true;
    expect(await evaluateStaffSession({ claims, binding: sid, now: NOW })).toEqual({
      ok: true,
      sessionId: null,
      fresh: null,
    });
  });

  it("finds pre-deploy sessions through the session cookie hash", async () => {
    const v = await evaluateStaffSession({
      claims,
      binding: { kind: "cookie", tokenHash: "h1" },
      now: NOW,
    });
    expect(v).toMatchObject({ ok: true, sessionId: "s1" });
  });
});
