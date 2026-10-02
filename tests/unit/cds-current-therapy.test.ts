/**
 * Audit G4-03 — the drug check saw only the prescriptions of the visit on
 * screen: warfarin from a course the patient is on, and ketorolac today,
 * came back green; metoclopramide for a G40 patient and sumatriptan after
 * a TIA too, although the catalog lists both contraindications.
 *
 * Pinned:
 *   1. An active warfarin course + ketorolac on a new visit warns, and
 *      names the course. Finished, paused and very old open-ended courses,
 *      and the rows of the visit being checked, do not count.
 *   2. Medicines from a recent pre-visit questionnaire count; an old one's
 *      do not.
 *   3. A drug prescribed again is continued, not «одно вещество дважды».
 *   4. Metoclopramide with G40 and sumatriptan with G45 / I63 warn about the
 *      contraindication, from the visit diagnosis, the card's diagnoses or a
 *      chronic condition; unrelated diagnoses stay quiet.
 *   5. The condition table cites a source for every mapping and no
 *      doctor-facing text of the new checks carries a dash.
 *
 * Review fixes:
 *   6. A coded record is decided by its code, not by the words of its ICD
 *      name: I11.9 «… без (застойной) сердечной недостаточности», R03.0
 *      «… при отсутствии диагноза гипертензии», I63.3 «Инфаркт мозга,
 *      вызванный тромбозом …» and I25.2 «Перенесенный в прошлом инфаркт
 *      миокарда» stay quiet on the drugs Aziz prescribes daily. An uncoded
 *      record does not count a denied mention («без ХСН»).
 *   7. An open-ended course counts for a year only for a drug taken long
 *      term: a ketorolac course from 90 days ago is not today's therapy,
 *      a warfarin one is.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTRAINDICATION_CONDITIONS,
  conditionsOfLine,
  findContraindicationHits,
  icdCodeIn,
} from "@/server/cds/contraindications";
import {
  isCourseCurrent,
  isLongTermTherapy,
  LONG_TERM_THERAPY,
  OPEN_COURSE_MAX_DAYS,
  OPEN_SHORT_COURSE_DAYS,
} from "@/server/cds/current-therapy";
import { ICD10_ENTRIES } from "@/server/icd10/data";

import { DRUGS } from "../../prisma/_drug-catalog";
import { DRUGS_EXTRA } from "../../prisma/_drug-catalog-extra";
import { DUPLICATE_DRUGS } from "../../scripts/_drug-duplicates";

import { cdsState, check, daysAgo, NOW, resetCdsState } from "./cds-fixture";

vi.mock("@/lib/prisma", async () => {
  const { makeCdsPrisma } = await import("./cds-fixture");
  return { prisma: makeCdsPrisma() };
});

beforeEach(() => resetCdsState());

function course(
  drugName: string,
  opts: Partial<{
    days: number | null;
    startedDaysAgo: number;
    status: string;
    visitNoteId: string | null;
    sortOrder: number | null;
  }> = {},
) {
  const start = daysAgo(opts.startedDaysAgo ?? 5);
  return {
    drugName,
    schedule: { times: ["08:00"], days: opts.days ?? null, startsAt: start.toISOString() },
    status: opts.status ?? "ACTIVE",
    createdAt: start,
    visitNoteId: opts.visitNoteId ?? null,
    visitNoteSortOrder: opts.sortOrder ?? null,
  };
}

describe("current therapy: running courses (acceptance)", () => {
  it("an active warfarin course + ketorolac today warns and names the course", async () => {
    cdsState.courses = [course("Варфарин", { days: 90, startedDaysAgo: 20 })];
    const r = await check(["ketorolac"]);
    const w = r.warnings.find(
      (x) => x.kind === "INTERACTION" && x.drugB?.id === "warfarin",
    );
    expect(w, JSON.stringify(r.warnings)).toBeDefined();
    expect(w!.severity).toBe("MAJOR");
    expect(w!.drugA.id).toBe("ketorolac");
    expect(w!.title).toContain("уже принимает");
    expect(w!.detail).toContain("текущий курс");
    expect(r.currentTherapy.map((d) => [d.id, d.source])).toEqual([
      ["warfarin", "COURSE"],
    ]);
    // The course is context, not a prescription of this visit.
    expect(r.resolvedDrugs.map((d) => d.id)).toEqual(["ketorolac"]);
  });

  it("a course bridged from a signed visit resolves through its visit row", async () => {
    // The mirrored row names the brand; the visit row holds the catalog id.
    cdsState.courses = [
      course("Какой-то бренд варфарина", { visitNoteId: "vn_old", sortOrder: 2, days: 60 }),
    ];
    cdsState.visitRows = [{ visitNoteId: "vn_old", sortOrder: 2, drugId: "warfarin" }];
    const r = await check(["ketorolac"]);
    expect(r.currentTherapy.map((d) => d.id)).toEqual(["warfarin"]);
    expect(r.warnings.some((w) => w.drugB?.id === "warfarin")).toBe(true);
  });

  it("finished, paused and year-old open-ended courses do not count", async () => {
    cdsState.courses = [
      course("Варфарин", { days: 10, startedDaysAgo: 30 }),
      course("Варфарин", { status: "PAUSED" }),
      course("Варфарин", { days: null, startedDaysAgo: OPEN_COURSE_MAX_DAYS + 10 }),
      course("Варфарин", { status: "CANCELLED" }),
    ];
    const r = await check(["ketorolac"]);
    expect(r.currentTherapy).toEqual([]);
    expect(r.warnings.some((w) => w.drugB?.id === "warfarin")).toBe(false);
  });

  it("the rows of the visit being checked are not its own current therapy", async () => {
    cdsState.courses = [course("Варфарин", { visitNoteId: "vn_now", sortOrder: 0 })];
    cdsState.visitRows = [{ visitNoteId: "vn_now", sortOrder: 0, drugId: "warfarin" }];
    const r = await check(["ketorolac"], { visitNoteId: "vn_now" });
    expect(r.currentTherapy).toEqual([]);
  });

  it("prescribing a drug the patient takes again is continuing it, not a double dose", async () => {
    cdsState.courses = [course("Карбамазепин", { days: 60 })];
    const r = await check(["carbamazepine"]);
    expect(r.currentTherapy).toEqual([]);
    expect(r.warnings.filter((w) => w.kind === "DUPLICATE_CLASS")).toEqual([]);
  });

  it("two drugs of the current therapy are not this visit's conflict", async () => {
    // Warfarin + ketorolac both running; today only citicoline.
    cdsState.courses = [course("Варфарин"), course("Кеторолак")];
    const r = await check(["citicoline"]);
    expect(
      r.warnings.filter((w) => w.kind === "INTERACTION" || w.kind === "DUPLICATE_CLASS"),
    ).toEqual([]);
  });
});

describe("current therapy: the pre-visit questionnaire", () => {
  const questionnaire = (submittedDaysAgo: number) => ({
    preVisitData: {
      complaints: "боль в спине",
      allergies: [],
      medications: ["Варфарин 5 мг"],
      notes: "",
      locale: "ru",
    },
    preVisitSubmittedAt: daysAgo(submittedDaysAgo),
  });

  it("a medicine from this visit's questionnaire counts, marked as the patient's word", async () => {
    cdsState.preVisit = questionnaire(2);
    const r = await check(["ketorolac"]);
    const w = r.warnings.find((x) => x.drugB?.id === "warfarin");
    expect(w).toBeDefined();
    expect(w!.title).toContain("со слов пациента");
    expect(r.currentTherapy[0]).toMatchObject({ id: "warfarin", source: "PATIENT_REPORTED" });
  });

  it("a questionnaire from months ago says nothing about today's therapy", async () => {
    cdsState.preVisit = questionnaire(120);
    const r = await check(["ketorolac"]);
    expect(r.currentTherapy).toEqual([]);
  });
});

describe("contraindications against the patient's diagnoses (acceptance)", () => {
  const contra = (r: Awaited<ReturnType<typeof check>>, id: string) =>
    r.warnings.filter((w) => w.kind === "DIAGNOSIS_RISK" && w.drugA.id === id);

  it("metoclopramide with a G40 visit diagnosis", async () => {
    const r = await check(["metoclopramide"], { diagnosisCode: "G40.9" });
    const [w] = contra(r, "metoclopramide");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("MAJOR");
    expect(w!.title).toContain("G40.9");
    expect(w!.detail).toContain("«Эпилепсия»");
  });

  it.each(["G45.9", "I63.5"])("sumatriptan with %s", async (code) => {
    const r = await check(["sumatriptan"], { diagnosisCode: code });
    const [w] = contra(r, "sumatriptan");
    expect(w).toBeDefined();
    expect(w!.detail).toContain("Цереброваскулярные нарушения");
  });

  it("the card's diagnoses and chronic list count, coded or by name", async () => {
    cdsState.diagnoses = [{ icd10Code: "I63.9", label: "Инфаркт мозга" }];
    expect(contra(await check(["sumatriptan"]), "sumatriptan")).toHaveLength(1);

    resetCdsState();
    cdsState.chronic = [{ name: "Эпилепсия, неуточнённая", notes: "МКБ-10: G40.9" }];
    expect(contra(await check(["metoclopramide"]), "metoclopramide")).toHaveLength(1);

    resetCdsState();
    // Typed at the desk, no code: named by the condition.
    cdsState.chronic = [{ name: "Эпилепсия", notes: null }];
    const byName = contra(await check(["metoclopramide"]), "metoclopramide");
    expect(byName.map((w) => w.title)).toEqual([
      "Противопоказан, эпилепсия: Метоклопрамид",
    ]);
  });

  it("a qualified label line warns one step softer (tramadol, uncontrolled epilepsy)", async () => {
    const r = await check(["tramadol"], { diagnosisCode: "G40.1" });
    const [w] = contra(r, "tramadol");
    expect(w!.severity).toBe("MODERATE");
    expect(w!.title).toMatch(/^Осторожно при G40\.1/);
  });

  it("stays quiet where the label does not apply", async () => {
    // Chronic cerebral ischaemia is not the stroke/TIA of the triptan label.
    cdsState.diagnoses = [
      { icd10Code: "I67.8", label: "Хроническая ишемия мозга" },
      { icd10Code: "G43.1", label: "Мигрень с аурой" },
    ];
    cdsState.chronic = [
      { name: "ХЦВН", notes: null },
      { name: "Судороги икроножных мышц", notes: null },
      { name: "Блокада ножки пучка Гиса", notes: null },
      { name: "Синдром внутричерепной гипертензии", notes: null },
    ];
    const r = await check(["sumatriptan", "metoclopramide", "carbamazepine"]);
    expect(r.warnings.filter((w) => w.kind === "DIAGNOSIS_RISK")).toEqual([]);
  });

  it("a curated pair's risk diagnoses read the card too, not only the visit", async () => {
    // losartan + ibuprofen is riskier with N18 (chronic kidney disease).
    cdsState.diagnoses = [{ icd10Code: "N18.3", label: "ХБП 3" }];
    const r = await check(["losartan", "ibuprofen"]);
    const w = r.warnings.find((x) => x.title.startsWith("Риск при N18.3"));
    expect(w?.kind).toBe("DIAGNOSIS_RISK");
  });
});

describe("coded diagnoses and denied mentions (review)", () => {
  const icdName = (code: string) => ICD10_ENTRIES.find((e) => e.code === code)!.nameRu;
  const risks = (r: Awaited<ReturnType<typeof check>>) =>
    r.warnings.filter((w) => w.kind === "DIAGNOSIS_RISK");

  it("I11.9 «без (застойной) сердечной недостаточности» is not heart failure", async () => {
    expect(icdName("I11.9")).toContain("без (застойной) сердечной недостаточности");
    cdsState.diagnoses = [{ icd10Code: "I11.9", label: icdName("I11.9") }];
    const r = await check(["milgamma", "diclofenac", "meloxicam", "drotaverine"]);
    expect(risks(r), JSON.stringify(risks(r))).toEqual([]);
  });

  it("R03.0 «при отсутствии диагноза гипертензии» is not hypertension", async () => {
    cdsState.diagnoses = [{ icd10Code: "R03.0", label: icdName("R03.0") }];
    expect(risks(await check(["sumatriptan", "venlafaxine"]))).toEqual([]);
  });

  it("I63.3, a stroke caused by thrombosis, does not ban cyanocobalamin", async () => {
    cdsState.diagnoses = [{ icd10Code: "I63.3", label: icdName("I63.3") }];
    expect(risks(await check(["cyanocobalamin"]))).toEqual([]);
    // Nor a B1 + B6 + B12 combination.
    expect(risks(await check(["milgamma"]))).toEqual([]);
    // It is still a stroke for the triptan label.
    const [w] = risks(await check(["sumatriptan"]));
    expect(w?.title).toContain("I63.3");
  });

  it("I25.2, an old myocardial infarction, is not an acute one", async () => {
    cdsState.diagnoses = [{ icd10Code: "I25.2", label: icdName("I25.2") }];
    expect(risks(await check(["amitriptyline", "pentoxifylline"]))).toEqual([]);
    // It still is ischaemic heart disease for the triptan label.
    expect(risks(await check(["sumatriptan"]))).toHaveLength(1);
  });

  it("an uncoded «Гипертоническая болезнь II ст., без ХСН» is not heart failure", async () => {
    cdsState.chronic = [{ name: "Гипертоническая болезнь II ст., без ХСН", notes: null }];
    expect(risks(await check(["milgamma", "diclofenac"]))).toEqual([]);

    resetCdsState();
    cdsState.chronic = [{ name: "Гипертоническая болезнь II ст., ХСН IIА", notes: null }];
    const hf = risks(await check(["milgamma"]));
    expect(hf.map((w) => w.detail).join(" ")).toContain("сердечная недостаточность");
  });

  it("a denial only reaches its own clause, and «не исключена» is not one", () => {
    const hits = (label: string, line = "Эпилепсия") =>
      findContraindicationHits([line], [{ code: null, label, origin: "CHRONIC" }]).length;
    expect(hits("Исключена эпилепсия")).toBe(0);
    expect(hits("Не исключена эпилепсия")).toBe(1);
    expect(hits("ХЦВН без эпилепсии")).toBe(0);
    expect(hits("Без судорог. Эпилепсия")).toBe(1);
    expect(hits("ГБ без поражения органов-мишеней с ХСН", "Хроническая сердечная недостаточность")).toBe(1);
  });

  it("a code field that is not a code leaves the record to its words", () => {
    const hits = findContraindicationHits(
      ["Эпилепсия"],
      [{ code: "нет", label: "Эпилепсия", origin: "DIAGNOSIS" }],
    );
    expect(hits).toHaveLength(1);
  });
});

describe("the condition table", () => {
  it("every condition cites where its codes come from", () => {
    for (const c of CONTRAINDICATION_CONDITIONS) {
      expect(c.source, c.key).toMatch(/^ICD-10 /);
      expect(c.icd.length, c.key).toBeGreaterThan(0);
    }
  });

  it("maps the catalog lines the audit named, and not their look-alikes", () => {
    const keys = (line: string) => conditionsOfLine(line).map((c) => c.key);
    expect(keys("Эпилепсия")).toEqual(["EPILEPSY"]);
    expect(keys("Цереброваскулярные нарушения (инсульт/ТИА)")).toEqual(["STROKE_TIA"]);
    expect(keys("ИБС, инфаркт миокарда в анамнезе")).toEqual(["IHD"]);
    expect(keys("Неконтролируемая эпилепсия")).toEqual(["EPILEPSY"]);
    expect(keys("Нелеченая надпочечниковая недостаточность")).toEqual([
      "ADRENAL_INSUFFICIENCY",
    ]);
    expect(keys("Гипертрофическая кардиомиопатия")).toEqual([]);
    expect(keys("Гемиплегическая и базилярная мигрень")).toEqual([]);
    expect(keys("Неврологические заболевания")).toEqual([]);
    expect(keys("Бронхиальная астма с непереносимостью НПВС")).toEqual([]);
  });

  it("a code in a free-text record is found", () => {
    expect(icdCodeIn("Эпилепсия", "МКБ-10: G40.9")).toBe("G40.9");
    expect(icdCodeIn("g43.0 мигрень")).toBe("G43.0");
    expect(icdCodeIn("Мигрень", null)).toBeNull();
  });

  it("one warning per condition even when two lines name it", () => {
    const hits = findContraindicationHits(
      ["Эпилепсия", "Эпилепсия, судороги в анамнезе"],
      [{ code: "G40.9", label: null, origin: "VISIT" }],
    );
    expect(hits).toHaveLength(1);
  });
});

describe("course clock", () => {
  it("counts a course until its last day and a planned one from now", () => {
    const c = (days: number | null, startedDaysAgo: number) => ({
      status: "ACTIVE",
      schedule: { days, startsAt: daysAgo(startedDaysAgo).toISOString() },
      createdAt: daysAgo(startedDaysAgo),
    });
    expect(isCourseCurrent(c(10, 9), NOW, false)).toBe(true);
    expect(isCourseCurrent(c(10, 11), NOW, false)).toBe(false);
    expect(isCourseCurrent(c(10, 11), NOW, true)).toBe(false);
    expect(isCourseCurrent(c(null, 200), NOW, true)).toBe(true);
    expect(isCourseCurrent(c(10, -3), NOW, false)).toBe(true);
  });

  it("an open-ended course counts for a year only when its drug is taken long term", () => {
    const c = (startedDaysAgo: number) => ({
      status: "ACTIVE",
      schedule: { days: null, startsAt: daysAgo(startedDaysAgo).toISOString() },
      createdAt: daysAgo(startedDaysAgo),
    });
    expect(isCourseCurrent(c(OPEN_SHORT_COURSE_DAYS - 1), NOW, false)).toBe(true);
    expect(isCourseCurrent(c(OPEN_SHORT_COURSE_DAYS + 1), NOW, false)).toBe(false);
    expect(isCourseCurrent(c(90), NOW, false)).toBe(false);
    expect(isCourseCurrent(c(90), NOW, true)).toBe(true);
  });

  it("knows which drugs are taken long term", () => {
    const atc = (atcCode: string) => [{ id: "x", atcCode }];
    // Anticoagulant, antiepileptic, antihypertensive, antidepressant.
    for (const code of ["B01AA03", "N03AG01", "C09CA01", "N06AA09", "N03AX16"]) {
      expect(isLongTermTherapy(atc(code)), code).toBe(true);
    }
    // NSAIDs, B vitamins, nootropics, muscle relaxants, benzodiazepines.
    for (const code of ["M01AB15", "M01AX17", "A11DBN", "N06BX06", "M03BX02", "N05BA01"]) {
      expect(isLongTermTherapy(atc(code)), code).toBe(false);
    }
    // A catalog row without an ATC code, by its id.
    expect(isLongTermTherapy([{ id: "oxcarbazepine", atcCode: null }])).toBe(true);
    // A combination counts through its components.
    expect(
      isLongTermTherapy([
        { id: "combo", atcCode: null },
        { id: "amlodipine", atcCode: "C08CA01" },
      ]),
    ).toBe(true);
  });

  it("every id of the long-term class is a catalog row", () => {
    // A retired G4-21 copy is no longer seeded but stays a live row until
    // scripts/fix-g4-21-duplicate-drugs.ts merges it.
    const ids = new Set([
      ...[...DRUGS, ...DRUGS_EXTRA].map((d) => d.id),
      ...DUPLICATE_DRUGS.map((d) => d.from),
    ]);
    for (const id of LONG_TERM_THERAPY.ids) expect(ids.has(id), id).toBe(true);
  });
});

describe("open-ended short courses (review)", () => {
  it("a ketorolac course from 90 days ago is not today's therapy for nimesulide", async () => {
    // Signed in July without a duration, bridged into an ACTIVE course.
    cdsState.courses = [
      course("Кеторолак", { days: null, startedDaysAgo: 90, visitNoteId: "vn_jul", sortOrder: 0 }),
    ];
    cdsState.visitRows = [{ visitNoteId: "vn_jul", sortOrder: 0, drugId: "ketorolac" }];
    const r = await check(["nimesulide"]);
    expect(r.currentTherapy).toEqual([]);
    expect(
      r.warnings.filter((w) => w.kind === "INTERACTION" || w.kind === "DUPLICATE_CLASS"),
    ).toEqual([]);
  });

  it("switching diclofenac for meloxicam months later is not a duplicate", async () => {
    cdsState.courses = [course("Диклофенак", { days: null, startedDaysAgo: 60 })];
    const r = await check(["meloxicam"]);
    expect(r.warnings.filter((w) => w.kind === "DUPLICATE_CLASS")).toEqual([]);
  });

  it("the same ketorolac from last week still counts", async () => {
    cdsState.courses = [course("Кеторолак", { days: null, startedDaysAgo: 7 })];
    const r = await check(["nimesulide"]);
    expect(r.currentTherapy.map((d) => d.id)).toEqual(["ketorolac"]);
  });

  it("an open-ended warfarin course from 90 days ago still counts", async () => {
    cdsState.courses = [course("Варфарин", { days: null, startedDaysAgo: 90 })];
    const r = await check(["ketorolac"]);
    expect(r.currentTherapy.map((d) => d.id)).toEqual(["warfarin"]);
    expect(r.warnings.some((w) => w.drugB?.id === "warfarin")).toBe(true);
  });

  it("an explicit duration still decides, whatever the class", async () => {
    cdsState.courses = [course("Кеторолак", { days: 120, startedDaysAgo: 90 })];
    const r = await check(["nimesulide"]);
    expect(r.currentTherapy.map((d) => d.id)).toEqual(["ketorolac"]);
  });

  it("an old open-ended course does not hide a newer running one of the same drug", async () => {
    cdsState.courses = [
      course("Кеторолак", { days: null, startedDaysAgo: 40 }),
      course("Кеторолак", { days: 60, startedDaysAgo: 45 }),
    ];
    const r = await check(["nimesulide"]);
    expect(r.currentTherapy.map((d) => d.id)).toEqual(["ketorolac"]);
  });
});

describe("no dash in the new doctor-facing text", () => {
  it("the engine's Russian templates", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/server/cds/drug-check.ts"),
      "utf8",
    )
      // Comments may use dashes; only string literals reach the doctor.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const literals = src.match(/`[^`]*`|"[^"\n]*"/g) ?? [];
    for (const l of literals.filter((x) => /[а-яё]/i.test(x))) {
      expect(l).not.toMatch(/[–—]/);
    }
  });

  it("condition names and record descriptions", () => {
    for (const c of CONTRAINDICATION_CONDITIONS) {
      expect(c.labelRu, c.key).not.toMatch(/[–—]/);
    }
    const hits = findContraindicationHits(
      ["Эпилепсия"],
      [{ code: "G40.9", label: "Эпилепсия", origin: "CHRONIC" }],
    );
    expect(hits[0]!.severity).toBe("MAJOR");
  });
});
