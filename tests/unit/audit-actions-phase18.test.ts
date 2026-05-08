/**
 * Phase 18 Wave 1 — analytics audit-action constants exist + are unique.
 */
import { describe, it, expect } from "vitest";

import { AUDIT_ACTION } from "@/lib/audit-actions";

const W1_KEYS = [
  "ANALYTICS_VIEWS_REFRESHED",
  "SAVED_REPORT_CREATED",
  "SAVED_REPORT_UPDATED",
  "SAVED_REPORT_DELETED",
  "SCHEDULED_REPORT_CREATED",
  "SCHEDULED_REPORT_UPDATED",
  "SCHEDULED_REPORT_DELETED",
  "SCHEDULED_REPORT_DELIVERED",
  "SCHEDULED_REPORT_FAILED",
  "ANALYTICS_REPORT_RUN",
] as const;

describe("Phase 18 Wave 1 audit actions", () => {
  it.each(W1_KEYS)("%s constant exists and is non-empty", (k) => {
    const v = (AUDIT_ACTION as Record<string, string>)[k];
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });

  it("all 10 Phase 18 W1 constants are unique within the AUDIT_ACTION map", () => {
    const values = Object.values(AUDIT_ACTION);
    expect(new Set(values).size).toBe(values.length);
  });

  it("Phase 18 keys are exactly the 10 declared", () => {
    for (const k of W1_KEYS) {
      expect(k in AUDIT_ACTION).toBe(true);
    }
  });
});
