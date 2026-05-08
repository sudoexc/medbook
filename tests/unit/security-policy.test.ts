/**
 * Phase 17 Wave 2 — security-policy predicates.
 *
 * The proxy reads these once per CRM hit, so behaviour HAS to be exact:
 * - SUPER_ADMIN/ADMIN are always required regardless of clinic flag.
 * - Other staff roles are required only when require2faForAll is on.
 */
import { describe, it, expect } from "vitest";

import {
  isMandatory2faRole,
  requiresTotpEnrollment,
} from "@/server/auth/security-policy";
import type { Role } from "@/lib/tenant-context";

const ALL_ROLES: Role[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "NURSE",
  "CALL_OPERATOR",
];

describe("isMandatory2faRole", () => {
  it("returns true for SUPER_ADMIN and ADMIN", () => {
    expect(isMandatory2faRole("SUPER_ADMIN")).toBe(true);
    expect(isMandatory2faRole("ADMIN")).toBe(true);
  });

  it("returns false for every non-admin staff role", () => {
    for (const r of ALL_ROLES) {
      if (r === "SUPER_ADMIN" || r === "ADMIN") continue;
      expect(isMandatory2faRole(r)).toBe(false);
    }
  });
});

describe("requiresTotpEnrollment", () => {
  it("ADMIN/SUPER_ADMIN are always required regardless of clinic flag", () => {
    for (const flag of [false, true]) {
      expect(
        requiresTotpEnrollment({
          role: "SUPER_ADMIN",
          clinicRequire2faForAll: flag,
        }),
      ).toBe(true);
      expect(
        requiresTotpEnrollment({ role: "ADMIN", clinicRequire2faForAll: flag }),
      ).toBe(true);
    }
  });

  it("non-admin roles are only required when the clinic flag is on", () => {
    for (const r of ALL_ROLES) {
      if (r === "SUPER_ADMIN" || r === "ADMIN") continue;
      expect(
        requiresTotpEnrollment({ role: r, clinicRequire2faForAll: false }),
      ).toBe(false);
      expect(
        requiresTotpEnrollment({ role: r, clinicRequire2faForAll: true }),
      ).toBe(true);
    }
  });
});
