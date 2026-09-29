/**
 * Clinic request 29.09.2026: a patient often leaves a visit with one to four
 * diagnoses (migraine with a tension headache and cervicalgia), and the
 * conclusion held one. The main diagnosis stays in diagnosisCode /
 * diagnosisName; up to three more live in VisitNote.additionalDiagnoses.
 *
 * Pinned here, the pure half:
 *   1. The set is settled one way for every writer: trimmed, no duplicate of
 *      the main one or of each other, no others without a main one, at most
 *      three others. The PATCH schema takes the list with the main one's
 *      limits and refuses a fourth.
 *   2. Every template lists the main one first, then the others: the
 *      patient handout (ru and uz, names only), the revision snapshot.
 *   3. A note with a single diagnosis reads exactly as before: same handout,
 *      same revision content, so earlier revisions still compare equal.
 *   4. The main diagnosis is what the pre-sign check asks for; the others
 *      are optional but make a draft non-blank.
 *   5. The doctor's shortlist counts the others as uses too.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_ADDITIONAL_DIAGNOSES,
  formatAdditionalDiagnoses,
  formatVisitDiagnosis,
  normalizeNoteDiagnoses,
  parseAdditionalDiagnoses,
  sameNoteDiagnoses,
  visitDiagnosesOf,
  visitDiagnosisCodes,
  visitDiagnosisKey,
} from "@/lib/visit-diagnoses";
import { UpdateVisitNoteSchema } from "@/server/schemas/visit-note";
import { composePatientHandout } from "@/lib/catalogs/handout-composer";
import { composeNoteHandout, touchesHandout } from "@/server/visit-notes/handout";
import {
  changedRevisionFields,
  revisionContentOf,
  sameRevisionContent,
} from "@/server/visit-notes/revisions";
import {
  draftHasContent,
  emptyConclusionSections,
} from "@/lib/visit-note-sections";
import {
  buildDiagnosisShortlist,
  noteDiagnosisUses,
} from "@/server/catalog/shortlist";

const MIGRAINE = { code: "G43.0", name: "Мигрень без ауры" };
const TENSION = { code: "G44.2", name: "Головная боль напряжённого типа" };
const CERVICALGIA = { code: "M54.2", name: "Цервикалгия" };
const TBI = { code: null, name: "Последствия ЧМТ" };

describe("reading the stored list", () => {
  it("anything that is not a list of diagnoses reads as none", () => {
    expect(parseAdditionalDiagnoses(undefined)).toEqual([]);
    expect(parseAdditionalDiagnoses(null)).toEqual([]);
    expect(parseAdditionalDiagnoses({ code: "G44.2" })).toEqual([]);
    expect(
      parseAdditionalDiagnoses([null, 7, "G44.2", { code: " ", name: "" }]),
    ).toEqual([]);
  });

  it("keeps order, trims, and reads a bare code as its own name", () => {
    expect(
      parseAdditionalDiagnoses([
        { code: " G44.2 ", name: " Головная боль напряжённого типа " },
        { code: null, name: "Последствия ЧМТ" },
        { code: "M54.2" },
      ]),
    ).toEqual([TENSION, TBI, { code: "M54.2", name: "M54.2" }]);
  });
});

describe("the set as it is stored", () => {
  it("drops a duplicate of the main one and of each other", () => {
    const out = normalizeNoteDiagnoses({
      diagnosisCode: "G43.0",
      diagnosisName: "Мигрень без ауры",
      additionalDiagnoses: [
        { code: "g43.0", name: "Мигрень" },
        TENSION,
        { code: "G44.2", name: "Другое название" },
        { code: null, name: "последствия  ЧМТ" },
        TBI,
      ],
    });
    expect(out).toEqual({
      diagnosisCode: "G43.0",
      diagnosisName: "Мигрень без ауры",
      additionalDiagnoses: [TENSION, { code: null, name: "последствия  ЧМТ" }],
    });
  });

  it("no main one but others: the first of them becomes the main one", () => {
    expect(
      normalizeNoteDiagnoses({
        diagnosisCode: null,
        diagnosisName: "  ",
        additionalDiagnoses: [TENSION, CERVICALGIA],
      }),
    ).toEqual({
      diagnosisCode: "G44.2",
      diagnosisName: "Головная боль напряжённого типа",
      additionalDiagnoses: [CERVICALGIA],
    });
  });

  it("keeps at most three others", () => {
    const out = normalizeNoteDiagnoses({
      ...{ diagnosisCode: MIGRAINE.code, diagnosisName: MIGRAINE.name },
      additionalDiagnoses: [TENSION, CERVICALGIA, TBI, { code: "R51", name: "Головная боль" }],
    });
    expect(MAX_ADDITIONAL_DIAGNOSES).toBe(3);
    expect(out.additionalDiagnoses).toEqual([TENSION, CERVICALGIA, TBI]);
  });

  it("a note without any stays without any", () => {
    expect(normalizeNoteDiagnoses({})).toEqual({
      diagnosisCode: null,
      diagnosisName: null,
      additionalDiagnoses: [],
    });
  });

  it("the same diagnosis is its code, or its words when it has none", () => {
    expect(visitDiagnosisKey({ code: "g43.0", name: "x" })).toBe("code:G43.0");
    expect(visitDiagnosisKey({ code: null, name: " Последствия  ЧМТ " })).toBe(
      "text:последствия чмт",
    );
    expect(visitDiagnosisKey({ code: " ", name: "" })).toBeNull();
  });

  it("order counts as a change; resending the same set does not", () => {
    const a = {
      diagnosisCode: "G43.0",
      diagnosisName: "Мигрень без ауры",
      additionalDiagnoses: [TENSION, CERVICALGIA],
    };
    expect(sameNoteDiagnoses(a, { ...a, additionalDiagnoses: [TENSION, CERVICALGIA] })).toBe(true);
    expect(sameNoteDiagnoses(a, { ...a, additionalDiagnoses: [CERVICALGIA, TENSION] })).toBe(false);
    expect(sameNoteDiagnoses(a, { ...a, additionalDiagnoses: undefined })).toBe(false);
  });
});

describe("reading order", () => {
  const note = {
    diagnosisCode: "G43.0",
    diagnosisName: "Мигрень без ауры",
    additionalDiagnoses: [TENSION, TBI, CERVICALGIA],
  };

  it("main one first, then the others as the doctor put them", () => {
    expect(visitDiagnosesOf(note)).toEqual([
      { ...MIGRAINE, main: true },
      { ...TENSION, main: false },
      { ...TBI, main: false },
      { ...CERVICALGIA, main: false },
    ]);
    expect(visitDiagnosisCodes(note)).toEqual(["G43.0", "G44.2", "M54.2"]);
  });

  it("an older note is its one diagnosis", () => {
    expect(
      visitDiagnosesOf({ diagnosisCode: null, diagnosisName: "Дорсопатия" }),
    ).toEqual([{ code: null, name: "Дорсопатия", main: true }]);
    expect(visitDiagnosesOf({ diagnosisCode: null, diagnosisName: null })).toEqual([]);
  });

  it("one line per diagnosis, whichever half exists", () => {
    expect(formatVisitDiagnosis(TENSION)).toBe("G44.2 · Головная боль напряжённого типа");
    expect(formatVisitDiagnosis(TBI)).toBe("Последствия ЧМТ");
    expect(formatVisitDiagnosis({ code: "M54.2", name: "M54.2" })).toBe("M54.2");
  });

  it("the others on one line for the history lists, in the doctor's order", () => {
    expect(formatAdditionalDiagnoses(note.additionalDiagnoses)).toBe(
      "G44.2 · Головная боль напряжённого типа; Последствия ЧМТ; M54.2 · Цервикалгия",
    );
    // A visit with one diagnosis, and an older note without the column.
    expect(formatAdditionalDiagnoses([])).toBe("");
    expect(formatAdditionalDiagnoses(undefined)).toBe("");
    // The stored JSON is read defensively: a broken entry is skipped.
    expect(formatAdditionalDiagnoses([{ code: 7 }, null, CERVICALGIA])).toBe(
      "M54.2 · Цервикалгия",
    );
  });
});

describe("the PATCH schema", () => {
  it("takes up to three with the main one's limits, trimmed", () => {
    const r = UpdateVisitNoteSchema.safeParse({
      additionalDiagnoses: [
        { code: " G44.2 ", name: " Головная боль напряжённого типа " },
        { code: null, name: "Последствия ЧМТ" },
        { name: "Цервикалгия" },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data!.additionalDiagnoses![0]).toEqual(TENSION);
  });

  it("refuses a fourth, a nameless one and an overlong code", () => {
    const four = [TENSION, CERVICALGIA, TBI, { code: "R51", name: "Головная боль" }];
    expect(UpdateVisitNoteSchema.safeParse({ additionalDiagnoses: four }).success).toBe(false);
    expect(
      UpdateVisitNoteSchema.safeParse({ additionalDiagnoses: [{ code: "G44.2", name: " " }] })
        .success,
    ).toBe(false);
    expect(
      UpdateVisitNoteSchema.safeParse({
        additionalDiagnoses: [{ code: "X".repeat(21), name: "Что-то" }],
      }).success,
    ).toBe(false);
  });
});

describe("the patient handout", () => {
  const base = {
    patientName: "Рахимов Сардор",
    doctorName: "Султанов Азиз",
    visitDate: new Date("2026-09-29T06:00:00Z"),
    diagnosisName: "Мигрень без ауры",
    advice: ["Режим сна"],
  };

  it("ru: the others follow the main one, by name", () => {
    const md = composePatientHandout({
      ...base,
      locale: "ru",
      additionalDiagnosisNames: [TENSION.name, CERVICALGIA.name],
    });
    const lines = md.split("\n");
    const main = lines.indexOf("**Диагноз:** Мигрень без ауры");
    expect(main).toBeGreaterThan(-1);
    expect(lines[main + 2]).toBe(
      "**Сопутствующие диагнозы:** Головная боль напряжённого типа; Цервикалгия",
    );
  });

  it("uz: the same, in Uzbek", () => {
    const md = composePatientHandout({
      ...base,
      locale: "uz",
      additionalDiagnosisNames: [TENSION.name],
    });
    expect(md).toContain("**Tashxis:** Мигрень без ауры");
    expect(md).toContain("**Yondosh tashxislar:** Головная боль напряжённого типа");
  });

  it("a single diagnosis composes exactly as before", () => {
    expect(composePatientHandout({ ...base, additionalDiagnosisNames: [] })).toBe(
      composePatientHandout(base),
    );
    expect(composePatientHandout(base)).not.toContain("Сопутствующие");
  });

  it("the note's handout carries names, never the codes", () => {
    const md = composeNoteHandout(
      { patient: { fullName: "Рахимов Сардор" } },
      {
        diagnosisName: MIGRAINE.name,
        additionalDiagnoses: [TENSION, TBI],
        complaints: [],
        prescriptions: [],
        advice: [],
        followUpNote: null,
        visitPrescriptions: [],
      },
    )!;
    expect(md).toContain(
      "**Сопутствующие диагнозы:** Головная боль напряжённого типа; Последствия ЧМТ",
    );
    expect(md).not.toContain("G44.2");
  });

  it("changing the others recomposes the handout", () => {
    expect(touchesHandout(["additionalDiagnoses"])).toBe(true);
  });
});

describe("the revision snapshot", () => {
  const note = {
    documentNumber: "NF-2026-000042",
    diagnosisCode: "G43.0",
    diagnosisName: "Мигрень без ауры",
    complaints: ["Головная боль"],
  };

  it("a note with one diagnosis snapshots as it did before the field existed", () => {
    const content = revisionContentOf({ ...note, additionalDiagnoses: [] }, []);
    expect("additionalDiagnoses" in content).toBe(false);
    // An earlier revision (written without the key) still equals it.
    const earlier = JSON.parse(JSON.stringify(revisionContentOf(note, [])));
    expect(sameRevisionContent(earlier, content)).toBe(true);
  });

  it("the others are part of what was signed, and a change to them is named", () => {
    const signed = revisionContentOf(
      { ...note, additionalDiagnoses: [TENSION, CERVICALGIA] },
      [],
    );
    expect(signed.additionalDiagnoses).toEqual([TENSION, CERVICALGIA]);
    const corrected = revisionContentOf(
      { ...note, additionalDiagnoses: [TENSION] },
      [],
    );
    expect(changedRevisionFields(signed, corrected)).toEqual(["additionalDiagnoses"]);
    const cleared = revisionContentOf({ ...note, additionalDiagnoses: [] }, []);
    expect(changedRevisionFields(signed, cleared)).toEqual(["additionalDiagnoses"]);
  });
});

describe("before signing", () => {
  const empty = { structuredRx: 0, bodyMarkdown: "Текст" };

  it("the main diagnosis is still the one asked for", () => {
    expect(
      emptyConclusionSections({ ...empty, additionalDiagnoses: [TENSION] }),
    ).toContain("diagnosis");
    expect(
      emptyConclusionSections({
        ...empty,
        diagnosisCode: "G43.0",
        diagnosisName: "Мигрень без ауры",
        additionalDiagnoses: [],
      }),
    ).not.toContain("diagnosis");
  });

  it("a draft holding only other diagnoses is not blank", () => {
    expect(draftHasContent({ structuredRx: 0 })).toBe(false);
    expect(draftHasContent({ structuredRx: 0, additionalDiagnoses: [TENSION] })).toBe(true);
  });
});

describe("the doctor's shortlist", () => {
  it("counts the others as uses of their own", () => {
    const at = new Date("2026-09-20T09:00:00Z");
    const notes = [
      { diagnosisCode: "G43.0", diagnosisName: MIGRAINE.name, additionalDiagnoses: [TENSION], createdAt: at },
      { diagnosisCode: "G43.0", diagnosisName: MIGRAINE.name, additionalDiagnoses: [TENSION, TBI], createdAt: at },
      { diagnosisCode: "M54.2", diagnosisName: CERVICALGIA.name, additionalDiagnoses: [], createdAt: at },
    ];
    expect(noteDiagnosisUses(notes[1]!)).toHaveLength(3);
    const rows = buildDiagnosisShortlist({
      pinnedCodes: [],
      uses: notes.flatMap(noteDiagnosisUses),
      nameForCode: () => null,
      limit: 10,
    });
    expect(Object.fromEntries(rows.map((r) => [r.code ?? r.name, r.count]))).toEqual({
      "G43.0": 2,
      "G44.2": 2,
      "M54.2": 1,
      "Последствия ЧМТ": 1,
    });
  });
});
