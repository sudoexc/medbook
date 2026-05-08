/**
 * Phase 17 Wave 3 — audit-action constant existence.
 *
 * The ROADMAP spec calls out 9 distinct audit actions for the DSAR pipeline
 * (5 export-related + 3 deletion-related + the dedicated PATIENT_ANONYMIZED).
 * `PATIENT_HARD_DELETED` is the 10th — reserved for the rare hard-delete
 * branch. We don't care about the value strings, only that each constant
 * key exists and is non-empty.
 */
import { describe, it, expect } from "vitest";

import { AUDIT_ACTION } from "@/lib/audit-actions";

const W3_KEYS = [
  "PATIENT_DATA_EXPORT_REQUESTED",
  "PATIENT_DATA_EXPORT_GENERATED",
  "PATIENT_DATA_EXPORT_DELIVERED",
  "PATIENT_DATA_EXPORT_DOWNLOADED",
  "PATIENT_DATA_EXPORT_FAILED",
  "PATIENT_DELETION_REQUESTED",
  "PATIENT_DELETION_APPROVED",
  "PATIENT_DELETION_CANCELLED",
  "PATIENT_HARD_DELETED",
  "PATIENT_ANONYMIZED",
] as const;

describe("Phase 17 Wave 3 audit actions", () => {
  it.each(W3_KEYS)("%s constant exists and is non-empty", (k) => {
    const v = (AUDIT_ACTION as Record<string, string>)[k];
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });

  it("each constant value is unique within the AUDIT_ACTION map", () => {
    const values = Object.values(AUDIT_ACTION);
    expect(new Set(values).size).toBe(values.length);
  });
});
