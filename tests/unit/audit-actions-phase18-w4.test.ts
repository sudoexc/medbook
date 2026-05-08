/**
 * Phase 18 Wave 4 — scheduled-report audit constants exist + are unique.
 *
 * The W4 spec adds `SCHEDULED_REPORT_DISABLED_AFTER_FAILURES`; the worker
 * also relies on the W1-reserved create/update/delete/delivered/failed
 * constants. This test guards against accidental duplicate values across the
 * whole AUDIT_ACTION map.
 */
import { describe, it, expect } from "vitest";

import { AUDIT_ACTION } from "@/lib/audit-actions";

const W4_KEYS = [
  "SCHEDULED_REPORT_CREATED",
  "SCHEDULED_REPORT_UPDATED",
  "SCHEDULED_REPORT_DELETED",
  "SCHEDULED_REPORT_DELIVERED",
  "SCHEDULED_REPORT_FAILED",
  "SCHEDULED_REPORT_DISABLED_AFTER_FAILURES",
] as const;

describe("Phase 18 Wave 4 audit actions", () => {
  it.each(W4_KEYS)("%s constant exists and is non-empty", (k) => {
    const v = (AUDIT_ACTION as Record<string, string>)[k];
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });

  it("each AUDIT_ACTION value is unique within the map", () => {
    const values = Object.values(AUDIT_ACTION);
    expect(new Set(values).size).toBe(values.length);
  });
});
