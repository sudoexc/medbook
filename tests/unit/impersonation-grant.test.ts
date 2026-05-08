/**
 * Phase 19 Wave 4 — `ImpersonationGrant` lifecycle helpers (pure-clock paths).
 *
 * The DB-bound helpers (`createGrant`, `getActiveGrant`, `endGrant`) are
 * exercised through Prisma in the integration suite. Here we only cover the
 * pure clock-checks the API guards rely on, plus the audit-action wiring.
 */
import { describe, it, expect } from "vitest";

import { isGrantExpired } from "@/server/platform/impersonation";
import { AUDIT_ACTION } from "@/lib/audit-actions";

describe("isGrantExpired", () => {
  it("returns false when expiresAt is in the future", () => {
    const now = new Date("2026-05-07T12:00:00Z");
    const expiresAt = new Date(now.getTime() + 30 * 60_000);
    expect(isGrantExpired({ expiresAt }, now)).toBe(false);
  });

  it("returns true when expiresAt is in the past", () => {
    const now = new Date("2026-05-07T12:00:00Z");
    const expiresAt = new Date(now.getTime() - 1_000);
    expect(isGrantExpired({ expiresAt }, now)).toBe(true);
  });

  it("treats expiresAt === now as expired (closed-interval semantics)", () => {
    const now = new Date("2026-05-07T12:00:00Z");
    expect(isGrantExpired({ expiresAt: now }, now)).toBe(true);
  });
});

describe("Phase 19 W4 audit constants", () => {
  it.each([
    "SUPER_ADMIN_IMPERSONATE_STARTED",
    "SUPER_ADMIN_IMPERSONATE_ENDED",
    "SUPER_ADMIN_IMPERSONATE_EXPIRED",
    "SUPER_ADMIN_VIEW_AS_BLOCKED",
    "BRANDING_CHANGED",
    "CLINIC_SUSPENDED",
    "CLINIC_RESUMED",
    "CLINIC_TRIAL_EXTENDED",
  ])("%s exists and is a non-empty string", (key) => {
    const v = (AUDIT_ACTION as Record<string, string>)[key];
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });
});
