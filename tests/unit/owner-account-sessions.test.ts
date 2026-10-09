/**
 * Owner account P0, the pure rules (owner request 09.10.2026,
 * docs/design/OWNER-ACCOUNT.md §1, §2 and §7 P0):
 *   - the SUPER_ADMIN keeps 3 sessions (the new one plus 2 previous), every
 *     other role still one; his 8 h cap runs per session;
 *   - the session guard keeps a SUPER_ADMIN inside a switched-off clinic he
 *     entered, and still locks that clinic's staff out;
 *   - «Продлить»: a fresh 60 minutes from the click, never past 8 h;
 *   - the banner's lease clock (mm:ss, amber in the last 5 minutes);
 *   - the entry request carries `breakGlass` only when the dialog set it.
 */
import { describe, expect, it, vi } from "vitest";

import {
  pickSessionsToKick,
  priorSessionsKept,
} from "@/server/auth/session-security";
import { decideStaffSession } from "@/server/auth/session-guard";
import { clinicLocksOut } from "@/server/auth/clinic-access";
import {
  IMPERSONATION_LEASE_MS,
  IMPERSONATION_MAX_MS,
  extendedLeaseEnd,
  maxLeaseEnd,
} from "@/server/platform/impersonation";
import {
  LEASE_WARN_MS,
  formatLeaseLeft,
  laterIso,
  leaseClock,
} from "@/lib/impersonation-lease";
import { postClinicEntry } from "@/lib/clinic-entry";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date("2026-10-09T09:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("pickSessionsToKick: the owner keeps his devices", () => {
  const rows = [
    { id: "laptop", createdAt: ago(3 * HOUR) },
    { id: "phone", createdAt: ago(1 * HOUR) },
    { id: "spare", createdAt: ago(2 * HOUR) },
    { id: "old", createdAt: ago(5 * HOUR) },
  ];

  it("a SUPER_ADMIN sign-in keeps the 2 newest previous sessions", () => {
    expect(priorSessionsKept("SUPER_ADMIN")).toBe(2);
    expect(pickSessionsToKick(rows, "SUPER_ADMIN").sort()).toEqual(["laptop", "old"]);
    expect(pickSessionsToKick(rows.slice(1, 3), "SUPER_ADMIN")).toEqual([]);
  });

  it("every other role still keeps none", () => {
    for (const role of ["DOCTOR", "ADMIN", "RECEPTIONIST", "NURSE", "CALL_OPERATOR", null, undefined]) {
      expect(pickSessionsToKick(rows, role).sort(), String(role)).toEqual([
        "laptop",
        "old",
        "phone",
        "spare",
      ]);
    }
  });
});

// ── session guard ──────────────────────────────────────────────────────────

type GuardUser = NonNullable<Parameters<typeof decideStaffSession>[0]["user"]>;
const user = (over: Partial<GuardUser> = {}): GuardUser => ({
  id: "u1",
  active: true,
  role: "DOCTOR",
  clinicId: "cOff",
  mustChangePassword: false,
  lastSessionRotatedAt: ago(HOUR),
  idleTimeoutMinutes: null,
  clinicActive: true,
  ...over,
});
const row = (over: { createdAt?: Date; lastActivityAt?: Date } = {}) => ({
  id: "s1",
  userId: "u1",
  createdAt: over.createdAt ?? ago(HOUR),
  lastActivityAt: over.lastActivityAt ?? ago(MIN),
});
const sid = { kind: "sid" as const, sessionId: "s1" };

describe("a switched-off clinic: the owner stays, its staff are out", () => {
  const owner = user({ role: "SUPER_ADMIN", clinicId: null, clinicActive: null });

  it("keeps a SUPER_ADMIN who entered the switched-off clinic", () => {
    const v = decideStaffSession({
      claims: { userId: "u1", role: "SUPER_ADMIN", clinicId: "cOff" },
      binding: sid,
      row: row(),
      user: owner,
      now: NOW,
    });
    expect(v).toMatchObject({ ok: true });
  });

  it("still locks that clinic's staff out", () => {
    const v = decideStaffSession({
      claims: { userId: "u1", role: "DOCTOR", clinicId: "cOff" },
      binding: sid,
      row: row(),
      user: user({ clinicActive: false }),
      now: NOW,
    });
    expect(v).toMatchObject({ ok: false, reason: "clinic-inactive" });
  });

  it("the lock-out rule holds by role whatever clinic is passed in", () => {
    expect(clinicLocksOut({ role: "SUPER_ADMIN", clinicId: "cOff", clinicActive: false })).toBe(false);
    expect(clinicLocksOut({ role: "ADMIN", clinicId: "cOff", clinicActive: false })).toBe(true);
  });

  it("the owner's 8 h cap runs per session: a phone sign-in does not stretch the laptop", () => {
    const phoneSignInJustNow = { ...owner, lastSessionRotatedAt: ago(10 * MIN) };
    const claims = { userId: "u1", role: "SUPER_ADMIN" as const, clinicId: null };
    const laptop = row({ createdAt: ago(8 * HOUR + MIN) });
    expect(
      decideStaffSession({ claims, binding: sid, row: laptop, user: phoneSignInJustNow, now: NOW }),
    ).toMatchObject({ ok: false, reason: "forced-rerotate" });
    expect(
      decideStaffSession({ claims, binding: sid, row: row({ createdAt: ago(7 * HOUR) }), user: phoneSignInJustNow, now: NOW }),
    ).toMatchObject({ ok: true });
  });

  it("clinic staff keep the account-wide anchor", () => {
    const claims = { userId: "u1", role: "DOCTOR" as const, clinicId: "cOff" };
    expect(
      decideStaffSession({
        claims,
        binding: sid,
        row: row({ createdAt: ago(HOUR) }),
        user: user({ lastSessionRotatedAt: ago(8 * HOUR + MIN) }),
        now: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "forced-rerotate" });
  });
});

// ── lease extension ────────────────────────────────────────────────────────

describe("extendedLeaseEnd: «Продлить»", () => {
  it("is a fresh 60 minutes from the click", () => {
    const g = { startedAt: ago(57 * MIN), expiresAt: new Date(NOW.getTime() + 3 * MIN) };
    expect(extendedLeaseEnd(g, NOW)).toEqual(new Date(NOW.getTime() + IMPERSONATION_LEASE_MS));
  });

  it("stops at 8 hours from the start, then cannot grow", () => {
    const startedAt = ago(7 * HOUR + 45 * MIN);
    const g = { startedAt, expiresAt: new Date(NOW.getTime() + 2 * MIN) };
    const cap = maxLeaseEnd(g);
    expect(cap).toEqual(new Date(startedAt.getTime() + IMPERSONATION_MAX_MS));
    expect(extendedLeaseEnd(g, NOW)).toEqual(cap);
    expect(extendedLeaseEnd({ startedAt, expiresAt: cap }, NOW)).toBeNull();
  });
});

describe("the banner's lease clock", () => {
  const at = (msLeft: number, capLeft = 4 * HOUR) =>
    leaseClock(
      new Date(NOW.getTime() + msLeft).toISOString(),
      new Date(NOW.getTime() + capLeft).toISOString(),
      NOW.getTime(),
    );

  it("counts mm:ss and turns amber in the last 5 minutes", () => {
    expect(formatLeaseLeft(IMPERSONATION_LEASE_MS)).toBe("60:00");
    expect(formatLeaseLeft(9 * MIN + 5_000)).toBe("09:05");
    expect(at(10 * MIN)).toMatchObject({ label: "10:00", warn: false, expired: false });
    expect(at(LEASE_WARN_MS)).toMatchObject({ label: "05:00", warn: true, canExtend: true });
  });

  it("offers no extension at the 8 h cap, and ends at zero", () => {
    expect(at(3 * MIN, 3 * MIN)).toMatchObject({ warn: true, canExtend: false });
    expect(at(-1000)).toMatchObject({ label: "00:00", expired: true, canExtend: false });
  });

  it("without a lease end there is no clock", () => {
    expect(leaseClock(null, null, NOW.getTime())).toBeNull();
  });

  it("the later end wins (the server's or the one «Продлить» returned)", () => {
    const a = "2026-10-09T09:05:00.000Z";
    const b = "2026-10-09T10:00:00.000Z";
    expect(laterIso(a, b)).toBe(b);
    expect(laterIso(b, a)).toBe(b);
    expect(laterIso(null, a)).toBe(a);
    expect(laterIso(a, undefined)).toBe(a);
  });
});

describe("the entry request", () => {
  it("sends breakGlass only for a switched-off clinic's entry", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    await postClinicEntry(
      "cOff",
      { reason: "проверка жалобы", mode: "VIEW_ONLY", breakGlass: true },
      fetchMock as unknown as typeof fetch,
    );
    await postClinicEntry(
      "cA",
      { reason: "проверка жалобы", mode: "VIEW_ONLY" },
      fetchMock as unknown as typeof fetch,
    );
    const bodies = fetchMock.mock.calls.map((c) =>
      JSON.parse(String((c as unknown as [string, RequestInit])[1].body)),
    );
    expect(bodies[0]).toEqual({
      clinicId: "cOff",
      reason: "проверка жалобы",
      mode: "VIEW_ONLY",
      breakGlass: true,
    });
    expect(bodies[1]).not.toHaveProperty("breakGlass");
  });
});
