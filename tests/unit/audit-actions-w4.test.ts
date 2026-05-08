/**
 * Phase 17 Wave 4 — encryption-related audit constants exist + are unique.
 */
import { describe, it, expect } from "vitest";

import { AUDIT_ACTION } from "@/lib/audit-actions";

const W4_KEYS = [
  "ENCRYPTION_HEALTH_CHECKED",
  "ENCRYPTION_DECRYPT_FAILED",
] as const;

describe("Phase 17 Wave 4 audit actions", () => {
  it.each(W4_KEYS)("%s constant exists and is non-empty", (k) => {
    const v = (AUDIT_ACTION as Record<string, string>)[k];
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });

  it("each constant value is unique within the AUDIT_ACTION map", () => {
    const values = Object.values(AUDIT_ACTION);
    expect(new Set(values).size).toBe(values.length);
  });
});
