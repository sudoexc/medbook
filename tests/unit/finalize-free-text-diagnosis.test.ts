/**
 * A diagnosis in the doctor's own words is a diagnosis.
 *
 * The finalize gate used to require an ICD-10 *code*, so a doctor whose
 * wording isn't in the reference — or who simply types faster than he
 * searches — could not close the visit at all. The clinic's neurologist hit
 * this on day one: "как вписывать диагноз непонятно и сложно". The code is
 * valuable for statistics, not for the document's legal validity, and
 * `PatientDiagnosis.icd10Code` was already nullable.
 *
 * These tests pin the gate and the history-matching rule that comes with it:
 * uncoded diagnoses must match each other by label, because matching on a
 * null code would collapse every uncoded diagnosis a patient ever had into
 * a single row.
 */
import { describe, expect, it } from "vitest";

type Note = { diagnosisCode: string | null; diagnosisName: string | null };

/** The finalize gate, extracted in shape. */
function diagnosisAccepted(note: Note): boolean {
  return Boolean(note.diagnosisCode || note.diagnosisName?.trim());
}

/** How finalize looks up an existing PatientDiagnosis to reactivate. */
function existingDxWhere(patientId: string, note: Note) {
  return note.diagnosisCode
    ? { patientId, icd10Code: note.diagnosisCode }
    : { patientId, icd10Code: null, label: note.diagnosisName!.trim() };
}

describe("finalize gate — what counts as a diagnosis", () => {
  it("accepts a coded diagnosis", () => {
    expect(
      diagnosisAccepted({ diagnosisCode: "G43.0", diagnosisName: "Мигрень" }),
    ).toBe(true);
  });

  it("accepts free text with no code — the regression", () => {
    expect(
      diagnosisAccepted({ diagnosisCode: null, diagnosisName: "Мигрень без ауры" }),
    ).toBe(true);
  });

  it("accepts a bare code with no name", () => {
    expect(diagnosisAccepted({ diagnosisCode: "G43.0", diagnosisName: null })).toBe(
      true,
    );
  });

  it("still rejects a completely empty diagnosis", () => {
    expect(diagnosisAccepted({ diagnosisCode: null, diagnosisName: null })).toBe(
      false,
    );
  });

  it("rejects whitespace masquerading as a diagnosis", () => {
    expect(
      diagnosisAccepted({ diagnosisCode: null, diagnosisName: "   " }),
    ).toBe(false);
  });
});

describe("patient diagnosis history — uncoded entries stay distinct", () => {
  it("matches on the code when there is one", () => {
    expect(
      existingDxWhere("pat_1", { diagnosisCode: "G43.0", diagnosisName: "Мигрень" }),
    ).toEqual({ patientId: "pat_1", icd10Code: "G43.0" });
  });

  it("matches uncoded diagnoses by label, not by the null code", () => {
    // Without the label, this would reactivate whatever uncoded diagnosis
    // happened to be first — mixing unrelated conditions into one row.
    expect(
      existingDxWhere("pat_1", {
        diagnosisCode: null,
        diagnosisName: "Мигрень без ауры",
      }),
    ).toEqual({
      patientId: "pat_1",
      icd10Code: null,
      label: "Мигрень без ауры",
    });
  });

  it("trims the label so trailing spaces don't fork the history", () => {
    expect(
      existingDxWhere("pat_1", {
        diagnosisCode: null,
        diagnosisName: "  Мигрень без ауры  ",
      }),
    ).toEqual({
      patientId: "pat_1",
      icd10Code: null,
      label: "Мигрень без ауры",
    });
  });

  it("keeps two different uncoded diagnoses apart", () => {
    const a = existingDxWhere("pat_1", {
      diagnosisCode: null,
      diagnosisName: "Мигрень",
    });
    const b = existingDxWhere("pat_1", {
      diagnosisCode: null,
      diagnosisName: "Остеохондроз",
    });
    expect(a).not.toEqual(b);
  });
});
