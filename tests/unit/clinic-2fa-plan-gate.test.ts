/**
 * Phase 17 Wave 2 — schema-level coverage for the two new clinic security
 * fields. The route-handler plan-gate logic is intentionally kept lean and
 * relies on the schema bound for `sessionIdleTimeoutMinutes` (the API has
 * to reject anything outside [5, 240] regardless of plan).
 *
 * Why a schema-only test: the plan-gate live in `src/app/api/crm/clinic/route.ts`
 * is exercised end-to-end via the integration / e2e tests; here we just
 * confirm the boundary contracts the route depends on.
 */
import { describe, it, expect } from "vitest";

import { UpdateClinicSettingsSchema } from "@/server/schemas/settings";

describe("UpdateClinicSettingsSchema — Wave 2 fields", () => {
  it("accepts require2faForAll as boolean", () => {
    expect(
      UpdateClinicSettingsSchema.safeParse({ require2faForAll: true }).success,
    ).toBe(true);
    expect(
      UpdateClinicSettingsSchema.safeParse({ require2faForAll: false }).success,
    ).toBe(true);
  });

  it("rejects require2faForAll non-boolean", () => {
    expect(
      UpdateClinicSettingsSchema.safeParse({ require2faForAll: "yes" }).success,
    ).toBe(false);
    expect(
      UpdateClinicSettingsSchema.safeParse({ require2faForAll: 1 }).success,
    ).toBe(false);
  });

  it("accepts sessionIdleTimeoutMinutes inside [5, 240]", () => {
    for (const v of [5, 30, 60, 240]) {
      const r = UpdateClinicSettingsSchema.safeParse({
        sessionIdleTimeoutMinutes: v,
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejects sessionIdleTimeoutMinutes outside [5, 240]", () => {
    for (const v of [0, 4, 241, 9999, -10]) {
      const r = UpdateClinicSettingsSchema.safeParse({
        sessionIdleTimeoutMinutes: v,
      });
      expect(r.success).toBe(false);
    }
  });

  it("rejects non-integer sessionIdleTimeoutMinutes", () => {
    expect(
      UpdateClinicSettingsSchema.safeParse({
        sessionIdleTimeoutMinutes: 30.5,
      }).success,
    ).toBe(false);
  });

  it("treats both new fields as optional (partial-update friendly)", () => {
    expect(UpdateClinicSettingsSchema.safeParse({}).success).toBe(true);
    expect(
      UpdateClinicSettingsSchema.safeParse({ nameRu: "Clinic" }).success,
    ).toBe(true);
  });
});
