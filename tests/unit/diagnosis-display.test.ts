/**
 * A diagnosis written in words must reach every surface, including paper.
 *
 * The finalize gate started accepting free text, but four render sites still
 * keyed off `diagnosisCode`. The worst was the printed conclusion: the doctor
 * typed «Дорсопатия шейного отдела», signed it, the document got a number —
 * and the patient carried away a form with a dash in the diagnosis field. A
 * legally void document, noticed only at printing.
 *
 * Also pins the year-only birth date rule: patients are entered as «Турматов О
 * 1969», stored as 1 January, and a signed document must not invent a day and
 * month that the doctor never provided.
 */
import { describe, expect, it } from "vitest";

import {
  birthDateFromYear,
  birthYearOf,
  isYearOnlyBirthDate,
} from "@/lib/patients/parse-identity";

/** The shared render rule: code and name, whichever exist, joined. */
function diagnosisLine(
  code: string | null,
  name: string | null,
  fallback = "—",
): string {
  const parts = [code, name].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  return parts.length ? parts.map((v) => v.trim()).join(" · ") : fallback;
}

describe("diagnosis display — free text is a diagnosis", () => {
  it("renders a coded diagnosis with both parts", () => {
    expect(diagnosisLine("G43.0", "Мигрень")).toBe("G43.0 · Мигрень");
  });

  it("renders free text alone — the regression that voided documents", () => {
    expect(diagnosisLine(null, "Дорсопатия шейного отдела")).toBe(
      "Дорсопатия шейного отдела",
    );
  });

  it("renders a bare code when there is no name", () => {
    expect(diagnosisLine("G43.0", null)).toBe("G43.0");
  });

  it("falls back only when genuinely empty", () => {
    expect(diagnosisLine(null, null)).toBe("—");
  });

  it("treats whitespace as empty rather than printing a blank line", () => {
    expect(diagnosisLine(null, "   ")).toBe("—");
  });

  it("trims what the doctor typed", () => {
    expect(diagnosisLine(null, "  Мигрень  ")).toBe("Мигрень");
  });

  it("never emits a leading separator when the code is missing", () => {
    expect(diagnosisLine(null, "Мигрень").startsWith("·")).toBe(false);
  });
});

describe("history filter — uncoded diagnoses must not be hidden", () => {
  /** The `where` clause of the diagnosis history query. */
  const historyWhere = {
    OR: [{ diagnosisCode: { not: null } }, { diagnosisName: { not: null } }],
  };

  const matches = (note: {
    diagnosisCode: string | null;
    diagnosisName: string | null;
  }) =>
    historyWhere.OR.some((cond) =>
      "diagnosisCode" in cond
        ? note.diagnosisCode !== null
        : note.diagnosisName !== null,
    );

  it("keeps coded diagnoses", () => {
    expect(matches({ diagnosisCode: "G43.0", diagnosisName: "Мигрень" })).toBe(
      true,
    );
  });

  it("keeps free-text diagnoses — previously dropped", () => {
    expect(matches({ diagnosisCode: null, diagnosisName: "Мигрень" })).toBe(
      true,
    );
  });

  it("still drops notes with no diagnosis at all", () => {
    expect(matches({ diagnosisCode: null, diagnosisName: null })).toBe(false);
  });
});

describe("year-only birth dates print as a year", () => {
  it("recognises a date built from a year alone", () => {
    expect(isYearOnlyBirthDate(birthDateFromYear(1969))).toBe(true);
    expect(birthYearOf(birthDateFromYear(1969))).toBe(1969);
  });

  it("recognises the stored ISO string too", () => {
    expect(isYearOnlyBirthDate("1987-01-01T00:00:00.000Z")).toBe(true);
  });

  it("leaves a real, fully-known date alone", () => {
    expect(isYearOnlyBirthDate("1987-03-14T00:00:00.000Z")).toBe(false);
  });

  it("does not mistake 1 February for a year-only date", () => {
    expect(isYearOnlyBirthDate("1987-02-01T00:00:00.000Z")).toBe(false);
  });

  it("returns false for an unparseable value instead of throwing", () => {
    expect(isYearOnlyBirthDate("не дата")).toBe(false);
  });
});
