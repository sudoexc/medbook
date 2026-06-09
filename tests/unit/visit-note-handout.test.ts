/**
 * P1.1 — visit-note-handout eligibility predicate.
 *
 * `hasDeliverableHandout` is the last gate before a clinical conclusion is
 * rendered for the patient, so its two rules are safety-critical and tested
 * exhaustively here without a database:
 *
 *   1. Only a FINALIZED note is ever deliverable — a DRAFT the doctor is still
 *      editing must never leak to the patient.
 *   2. The handout must carry real text — null / empty / whitespace-only is
 *      skipped (the sweep query already filters non-null, but an all-blank
 *      string survives that filter and must still be rejected).
 *
 * Note the predicate only ever looks at `patientHandoutMarkdown`; the clinical
 * `bodyMarkdown` is structurally absent from its input type, which is the
 * type-level half of the "never deliver bodyMarkdown" guarantee.
 */
import { describe, expect, it } from "vitest";

import { hasDeliverableHandout } from "@/server/workers/visit-note-handout";

describe("hasDeliverableHandout", () => {
  it("is true for a FINALIZED note with real handout text", () => {
    expect(
      hasDeliverableHandout({
        status: "FINALIZED",
        patientHandoutMarkdown: "# Рекомендации\n- Пить воду",
      }),
    ).toBe(true);
  });

  it("is false for any non-FINALIZED status, even with a handout", () => {
    for (const status of ["DRAFT", "IN_PROGRESS", "ARCHIVED", ""]) {
      expect(
        hasDeliverableHandout({
          status,
          patientHandoutMarkdown: "# Памятка",
        }),
        `status=${status}`,
      ).toBe(false);
    }
  });

  it("is false when the handout is null", () => {
    expect(
      hasDeliverableHandout({
        status: "FINALIZED",
        patientHandoutMarkdown: null,
      }),
    ).toBe(false);
  });

  it("is false for an empty-string handout", () => {
    expect(
      hasDeliverableHandout({
        status: "FINALIZED",
        patientHandoutMarkdown: "",
      }),
    ).toBe(false);
  });

  it("is false for a whitespace-only handout (survives the not-null query filter)", () => {
    expect(
      hasDeliverableHandout({
        status: "FINALIZED",
        patientHandoutMarkdown: "   \n\t  ",
      }),
    ).toBe(false);
  });
});
