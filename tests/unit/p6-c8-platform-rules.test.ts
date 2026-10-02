/**
 * Audit P6 C8 — the pure rules behind the platform panel fixes:
 *   G5-06 last-admin and doctor-card rules of «Переназначить»;
 *   G5-09 when a SUPER_ADMIN leaves the CRM and when it says why;
 *   G5-12 the «Здоровье» cards from live checks;
 *   G5-14 the effective flags of a subscription and what a change switches.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  leavesAdminSeat,
  planPlatformDoctorCard,
} from "@/server/platform/user-change";
import { sendsSuperAdminToPlatform } from "@/server/auth/staff-redirects";
import { EXPIRY_NOTICE_MS, lapsedRecently } from "@/server/platform/impersonation";
import { overallOf, serviceCard, workersCard } from "@/server/platform/health-cards";
import {
  DEFAULT_FLAGS,
  ENTERPRISE_FLAGS,
  effectiveFlags,
  flagChanges,
} from "@/lib/feature-flags";

describe("G5-06 leavesAdminSeat", () => {
  const admin = { role: "ADMIN", active: true, clinicId: "c1" };

  it("is true when an active ADMIN is switched off, demoted or moved away", () => {
    expect(leavesAdminSeat(admin, { ...admin, active: false })).toBe(true);
    expect(leavesAdminSeat(admin, { ...admin, role: "RECEPTIONIST" })).toBe(true);
    expect(leavesAdminSeat(admin, { ...admin, clinicId: "c2" })).toBe(true);
  });

  it("is false when the ADMIN stays, or the account was no active ADMIN", () => {
    expect(leavesAdminSeat(admin, admin)).toBe(false);
    expect(leavesAdminSeat({ ...admin, active: false }, { ...admin, role: "NURSE" })).toBe(false);
    expect(
      leavesAdminSeat({ role: "DOCTOR", active: true, clinicId: "c1" }, { ...admin, active: false }),
    ).toBe(false);
  });
});

describe("G5-06 planPlatformDoctorCard", () => {
  const card = { id: "d1", clinicId: "c1" };
  const doctor = { role: "DOCTOR", active: true, clinicId: "c1" };
  const plan = (
    after: typeof doctor,
    c: typeof card | null = card,
    before: typeof doctor = doctor,
  ) => planPlatformDoctorCard({ before, after, card: c });

  it("keeps the card of an active doctor in the card's clinic", () => {
    expect(plan(doctor)).toEqual({ ok: true, unlinkCardId: null });
  });

  it("refuses to move an active doctor away from the card's clinic", () => {
    expect(plan({ ...doctor, clinicId: "c2" })).toEqual({
      ok: false,
      reason: "doctor_card_bound",
    });
  });

  it("releases the card of a doctor switched off or given another role, moved or not", () => {
    expect(plan({ ...doctor, active: false })).toEqual({ ok: true, unlinkCardId: "d1" });
    expect(plan({ ...doctor, role: "RECEPTIONIST", clinicId: "c2" })).toEqual({
      ok: true,
      unlinkCardId: "d1",
    });
  });

  it("keeps the card when a deactivated doctor who still holds one is switched back on", () => {
    expect(plan(doctor, card, { ...doctor, active: false })).toEqual({
      ok: true,
      unlinkCardId: null,
    });
  });

  // Review of C8: «Деактивировать» released the card, then «Активировать» (or
  // DOCTOR → NURSE → DOCTOR) brought back an active doctor with no card.
  it("refuses to switch on or promote into an active doctor without a card", () => {
    expect(plan(doctor, null, { ...doctor, active: false })).toEqual({
      ok: false,
      reason: "doctor_id_required",
    });
    expect(plan(doctor, null, { ...doctor, role: "NURSE" })).toEqual({
      ok: false,
      reason: "doctor_id_required",
    });
  });

  it("leaves alone what this edit does not turn into a cardless doctor", () => {
    // An active doctor who already had no card: a move or a no-op passes.
    expect(plan({ ...doctor, clinicId: "c2" }, null)).toEqual({ ok: true, unlinkCardId: null });
    expect(plan(doctor, null)).toEqual({ ok: true, unlinkCardId: null });
    // Not a doctor afterwards, or switched off: nothing to bind.
    expect(plan({ ...doctor, role: "NURSE" }, null)).toEqual({ ok: true, unlinkCardId: null });
    expect(plan({ ...doctor, active: false }, null, { ...doctor, active: false })).toEqual({
      ok: true,
      unlinkCardId: null,
    });
  });
});

describe("G5-09 sendsSuperAdminToPlatform", () => {
  const base = { surface: "crm" as const, subpath: "patients", role: "SUPER_ADMIN", clinicId: null };

  it("sends a SUPER_ADMIN without a clinic from CRM pages to the platform", () => {
    expect(sendsSuperAdminToPlatform(base)).toBe(true);
    expect(sendsSuperAdminToPlatform({ ...base, subpath: "" })).toBe(true);
  });

  it("leaves the account pages, an impersonating SUPER_ADMIN and other roles alone", () => {
    expect(sendsSuperAdminToPlatform({ ...base, subpath: "me/change-password" })).toBe(false);
    expect(sendsSuperAdminToPlatform({ ...base, subpath: "me/security" })).toBe(false);
    expect(sendsSuperAdminToPlatform({ ...base, clinicId: "c1" })).toBe(false);
    expect(sendsSuperAdminToPlatform({ ...base, role: "ADMIN" })).toBe(false);
    expect(sendsSuperAdminToPlatform({ ...base, surface: "doctor" })).toBe(false);
  });
});

describe("G5-09 lapsedRecently", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("is true for a lease that ran out recently, closed by the sweep or not yet", () => {
    expect(lapsedRecently({ expiresAt: ago(60_000), endedAt: null, endedReason: null }, now)).toBe(true);
    expect(
      lapsedRecently({ expiresAt: ago(60_000), endedAt: ago(60_000), endedReason: "expired" }, now),
    ).toBe(true);
  });

  it("is false for an exit, a live grant, an old lapse or no grant", () => {
    expect(
      lapsedRecently({ expiresAt: ago(60_000), endedAt: ago(120_000), endedReason: "user_exit" }, now),
    ).toBe(false);
    expect(
      lapsedRecently({ expiresAt: new Date(now.getTime() + 60_000), endedAt: null, endedReason: null }, now),
    ).toBe(false);
    expect(
      lapsedRecently({ expiresAt: ago(EXPIRY_NOTICE_MS + 1), endedAt: null, endedReason: null }, now),
    ).toBe(false);
    expect(lapsedRecently(null, now)).toBe(false);
  });
});

describe("G5-12 health cards", () => {
  it("turns a timeout into DOWN and keeps not_configured", () => {
    expect(serviceCard("redis", { status: "timeout" })).toMatchObject({ status: "down" });
    expect(serviceCard("minio", { status: "not_configured", details: "x" })).toMatchObject({
      status: "not_configured",
      details: "x",
    });
  });

  it("names how long ago the worker beat and which loops are late", () => {
    const card = workersCard({
      status: "degraded",
      processAgeSec: 12,
      staleLoops: ["trial-expiry:scan"],
      outbox: { oldestPendingSec: null, dead24h: 2 },
    });
    expect(card).toMatchObject({ name: "workers", status: "degraded" });
    expect(card.details).toContain("12 s");
    expect(card.details).toContain("trial-expiry:scan");
    expect(card.details).toContain("dead (24h): 2");
    expect(workersCard({ status: "down", processAgeSec: null }).details).toContain("no process beat");
  });

  it("is degraded overall when any card is down or degraded", () => {
    expect(overallOf([{ status: "ok" }, { status: "down" }])).toBe("degraded");
    expect(overallOf([{ status: "ok" }, { status: "degraded" }])).toBe("degraded");
    expect(overallOf([{ status: "ok" }, { status: "not_configured" }])).toBe("partial");
    expect(overallOf([{ status: "ok" }, { status: "ok" }])).toBe("ok");
  });
});

describe("G5-14 effective flags and what a change switches", () => {
  const pro = { hasCallCenter: true, hasTelegramInbox: true, hasAnalyticsPro: true };

  it("drops a cancelled subscription to Basic and keeps the plan otherwise", () => {
    expect(effectiveFlags({ status: "CANCELLED", planFeatures: pro })).toEqual(DEFAULT_FLAGS);
    expect(effectiveFlags(null)).toEqual(DEFAULT_FLAGS);
    for (const status of ["TRIAL", "ACTIVE", "PAST_DUE"]) {
      expect(effectiveFlags({ status, planFeatures: pro }).hasCallCenter).toBe(true);
    }
  });

  it("lists the features a change turns off and on", () => {
    expect(flagChanges(ENTERPRISE_FLAGS, DEFAULT_FLAGS)).toEqual({
      off: ["hasCallCenter", "hasTelegramInbox", "hasAnalyticsPro", "hasWhiteLabel", "hasCustomSubdomain"],
      on: [],
    });
    expect(flagChanges(DEFAULT_FLAGS, { ...DEFAULT_FLAGS, hasCallCenter: true })).toEqual({
      off: [],
      on: ["hasCallCenter"],
    });
    expect(flagChanges(DEFAULT_FLAGS, DEFAULT_FLAGS)).toEqual({ off: [], on: [] });
  });
});

describe("G5-08 / G5-15 platform pages", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  it("the /admin top bar signs out and titles the encryption page", () => {
    const src = read("src/app/admin/_components/admin-topbar.tsx");
    expect(src).toMatch(/signOut\(\{ callbackUrl: "\/login" \}\)/);
    expect(src).toContain('"encryption-health": {');
    expect(src).toContain("Шифрование");
  });

  it("the encryption page no longer polls", () => {
    const src = read("src/app/admin/encryption-health/_components/encryption-health-client.tsx");
    expect(src).not.toMatch(/refetchInterval/);
  });

  it("the one-time password window closes only by its button", () => {
    const src = read("src/app/admin/clinics/_components/clinics-page-client.tsx");
    expect(src).toContain("disablePointerDismissal");
    expect(src).not.toMatch(/if \(!v\) onClose\(\);/);
  });
});
