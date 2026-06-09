/**
 * Phase G8 / P2.3 — CDS-override schema guard.
 *
 * The override row is the audit trail for a doctor knowingly prescribing
 * through a contraindication, so the one invariant worth locking before any
 * DB write runs is: a bare `OTHER` reason must carry a free-text note. The
 * four named reasons are self-documenting; `OTHER` without a note tells a
 * future auditor nothing about why the warning was dismissed.
 */
import { describe, expect, it } from "vitest";

import { CreateCdsOverrideSchema } from "@/server/schemas/cds-overrides";

describe("CreateCdsOverrideSchema", () => {
  const base = {
    patientId: "patient-1",
    warningKind: "INTERACTION" as const,
    severity: "MAJOR" as const,
    warningTitle: "Варфарин + Аспирин",
    warningDetail: "Совместный приём повышает риск кровотечения.",
  };

  it("accepts a named reason with no note", () => {
    const parsed = CreateCdsOverrideSchema.safeParse({
      ...base,
      reason: "CLINICALLY_JUSTIFIED",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects OTHER with no note", () => {
    const parsed = CreateCdsOverrideSchema.safeParse({
      ...base,
      reason: "OTHER",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects OTHER with a whitespace-only note (trims to empty)", () => {
    const parsed = CreateCdsOverrideSchema.safeParse({
      ...base,
      reason: "OTHER",
      reasonNote: "   ",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts OTHER once a real note is supplied", () => {
    const parsed = CreateCdsOverrideSchema.safeParse({
      ...base,
      reason: "OTHER",
      reasonNote: "Пациент уже получает антидот, риск контролируется.",
    });
    expect(parsed.success).toBe(true);
  });

  it("does not demand a note for the four named reasons", () => {
    for (const reason of [
      "CLINICALLY_JUSTIFIED",
      "PATIENT_INFORMED",
      "ALTERNATIVES_TRIED",
      "FALSE_POSITIVE",
    ] as const) {
      expect(
        CreateCdsOverrideSchema.safeParse({ ...base, reason }).success,
        `reason ${reason} should not require a note`,
      ).toBe(true);
    }
  });

  it("points the validation error at reasonNote", () => {
    const parsed = CreateCdsOverrideSchema.safeParse({
      ...base,
      reason: "OTHER",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toContain("reasonNote");
    }
  });

  it("still requires the snapshot fields", () => {
    const parsed = CreateCdsOverrideSchema.safeParse({
      patientId: "patient-1",
      warningKind: "INTERACTION",
      severity: "MAJOR",
      warningTitle: "   ",
      warningDetail: "x",
      reason: "FALSE_POSITIVE",
    });
    expect(parsed.success).toBe(false);
  });
});
