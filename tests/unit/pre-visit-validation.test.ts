/**
 * Phase 16 Wave 2 — Pre-visit questionnaire validators.
 *
 * Pure-helper unit tests covering:
 *
 *   1. `PreVisitSubmissionSchema` — Zod validation of the form body. Rejects
 *      empty complaints, oversized blobs, and oversized list entries.
 *   2. `isPreVisitEligible` — 23–25h-from-now window boundaries, status gate,
 *      patient-contact gate, and dedupe stamps.
 *   3. `parsePreVisitData` — defensive coercion of stored JSON (null /
 *      malformed / partial fills).
 *
 * No Prisma, no React. Everything here is a deterministic in-memory check.
 */
import { describe, expect, it } from "vitest";

import {
  PreVisitSubmissionSchema,
  isPreVisitEligible,
  parsePreVisitData,
} from "@/lib/patient-experience/pre-visit";

describe("PreVisitSubmissionSchema", () => {
  it("accepts a fully-populated minimal payload", () => {
    const r = PreVisitSubmissionSchema.safeParse({
      complaints: "Головная боль",
      allergies: ["пенициллин"],
      medications: ["аспирин 100мг"],
      notes: "Раз в неделю",
    });
    expect(r.success).toBe(true);
  });

  it("defaults `notes` to empty string when omitted", () => {
    const r = PreVisitSubmissionSchema.safeParse({
      complaints: "X",
      allergies: [],
      medications: [],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.notes).toBe("");
  });

  it("rejects empty complaints (required)", () => {
    const r = PreVisitSubmissionSchema.safeParse({
      complaints: "",
      allergies: [],
      medications: [],
      notes: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects whitespace-only complaints", () => {
    const r = PreVisitSubmissionSchema.safeParse({
      complaints: "    ",
      allergies: [],
      medications: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects complaints over 2000 chars", () => {
    const r = PreVisitSubmissionSchema.safeParse({
      complaints: "a".repeat(2001),
      allergies: [],
      medications: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 20 allergies", () => {
    const r = PreVisitSubmissionSchema.safeParse({
      complaints: "X",
      allergies: Array.from({ length: 21 }, (_, i) => `a${i}`),
      medications: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 20 medications", () => {
    const r = PreVisitSubmissionSchema.safeParse({
      complaints: "X",
      allergies: [],
      medications: Array.from({ length: 21 }, (_, i) => `m${i}`),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an allergy entry over 120 chars", () => {
    const r = PreVisitSubmissionSchema.safeParse({
      complaints: "X",
      allergies: ["a".repeat(121)],
      medications: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a medication entry over 200 chars", () => {
    const r = PreVisitSubmissionSchema.safeParse({
      complaints: "X",
      allergies: [],
      medications: ["m".repeat(201)],
    });
    expect(r.success).toBe(false);
  });

  it("rejects notes over 1000 chars", () => {
    const r = PreVisitSubmissionSchema.safeParse({
      complaints: "X",
      allergies: [],
      medications: [],
      notes: "n".repeat(1001),
    });
    expect(r.success).toBe(false);
  });
});

describe("isPreVisitEligible", () => {
  const now = new Date("2026-05-06T10:00:00.000Z");

  const baseRow = {
    status: "BOOKED",
    preVisitNotifiedAt: null,
    preVisitSubmittedAt: null,
    patientHasContact: true,
  };

  it("returns true for a row exactly 24h ahead", () => {
    const startsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(isPreVisitEligible({ ...baseRow, startsAt }, now)).toBe(true);
  });

  it("returns true at the lower bound (exactly 23h)", () => {
    const startsAt = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    expect(isPreVisitEligible({ ...baseRow, startsAt }, now)).toBe(true);
  });

  it("returns true at the upper bound (exactly 25h)", () => {
    const startsAt = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    expect(isPreVisitEligible({ ...baseRow, startsAt }, now)).toBe(true);
  });

  it("returns false just under 23h (too soon)", () => {
    const startsAt = new Date(now.getTime() + 23 * 60 * 60 * 1000 - 60_000);
    expect(isPreVisitEligible({ ...baseRow, startsAt }, now)).toBe(false);
  });

  it("returns false just over 25h (too far away)", () => {
    const startsAt = new Date(now.getTime() + 25 * 60 * 60 * 1000 + 60_000);
    expect(isPreVisitEligible({ ...baseRow, startsAt }, now)).toBe(false);
  });

  it("returns false when already notified", () => {
    const startsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(
      isPreVisitEligible(
        { ...baseRow, startsAt, preVisitNotifiedAt: new Date(now) },
        now,
      ),
    ).toBe(false);
  });

  it("returns false when already submitted", () => {
    const startsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(
      isPreVisitEligible(
        { ...baseRow, startsAt, preVisitSubmittedAt: new Date(now) },
        now,
      ),
    ).toBe(false);
  });

  it("returns false when patient has no contact (no TG, no phone)", () => {
    const startsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(
      isPreVisitEligible(
        { ...baseRow, startsAt, patientHasContact: false },
        now,
      ),
    ).toBe(false);
  });

  it("returns false for COMPLETED / CANCELLED status", () => {
    const startsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(
      isPreVisitEligible({ ...baseRow, startsAt, status: "COMPLETED" }, now),
    ).toBe(false);
    expect(
      isPreVisitEligible({ ...baseRow, startsAt, status: "CANCELLED" }, now),
    ).toBe(false);
  });

  it("returns true for both BOOKED and WAITING", () => {
    const startsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(
      isPreVisitEligible({ ...baseRow, startsAt, status: "BOOKED" }, now),
    ).toBe(true);
    expect(
      isPreVisitEligible({ ...baseRow, startsAt, status: "WAITING" }, now),
    ).toBe(true);
  });
});

describe("parsePreVisitData", () => {
  it("returns null for null / undefined / non-object input", () => {
    expect(parsePreVisitData(null)).toBeNull();
    expect(parsePreVisitData(undefined)).toBeNull();
    expect(parsePreVisitData("string")).toBeNull();
    expect(parsePreVisitData(42)).toBeNull();
  });

  it("returns null when every field is empty (malformed)", () => {
    expect(
      parsePreVisitData({
        complaints: "",
        allergies: [],
        medications: [],
        notes: "",
      }),
    ).toBeNull();
  });

  it("recovers a partially-filled blob (just complaints)", () => {
    const r = parsePreVisitData({ complaints: "Боль" });
    expect(r).not.toBeNull();
    expect(r!.complaints).toBe("Боль");
    expect(r!.allergies).toEqual([]);
    expect(r!.medications).toEqual([]);
    expect(r!.notes).toBe("");
    expect(r!.locale).toBe("ru");
  });

  it("preserves locale: 'uz' when present", () => {
    const r = parsePreVisitData({ complaints: "X", locale: "uz" });
    expect(r!.locale).toBe("uz");
  });

  it("falls back to 'ru' for unknown locale strings", () => {
    const r = parsePreVisitData({ complaints: "X", locale: "en" });
    expect(r!.locale).toBe("ru");
  });

  it("filters non-string entries out of allergies / medications", () => {
    const r = parsePreVisitData({
      complaints: "X",
      allergies: ["valid", null, 42, "another"],
      medications: ["m1", undefined, "m2"],
    });
    expect(r!.allergies).toEqual(["valid", "another"]);
    expect(r!.medications).toEqual(["m1", "m2"]);
  });

  it("treats non-array allergies / medications as empty", () => {
    const r = parsePreVisitData({
      complaints: "X",
      allergies: "should be array",
      medications: 42,
    });
    expect(r!.allergies).toEqual([]);
    expect(r!.medications).toEqual([]);
  });
});
