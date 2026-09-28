/**
 * Audit G4-08 — the register import gives its own row to substances the
 * curated catalog knows («Тромбо АСС», «КЛОСАРТ», «КАРБАЛЕКС», an uncoded
 * «Диклофенак натрия») and to combinations («Диоксафлекс B12»: betamethasone
 * + hydroxocobalamin + diclofenac). Those rows had no curated pair, no
 * pregnancy category, no contraindications: the engine stayed silent on a
 * substance it warns about under the curated card.
 *
 * Pinned (acceptance):
 *   1. «Тромбо АСС», «КЛОСАРТ» and «КАРБАЛЕКС» give the same warnings as
 *      their curated analogues: curated pairs, pregnancy category,
 *      contraindications.
 *   2. «Диоксафлекс B12» + «Ибупрофен» warns about stacking NSAIDs.
 *   3. An uncoded register row is the substance its name says: next to the
 *      curated row it is one substance twice, and it is not reported as
 *      «нет данных о взаимодействиях».
 *   4. P2 behaviour holds: a vitamin combination next to one of its vitamins
 *      stays quiet.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  combinationParts,
  componentNames,
  strictestCategory,
} from "@/server/cds/substance-profile";

import { cdsState, check, registerRow, resetCdsState } from "./cds-fixture";

vi.mock("@/lib/prisma", async () => {
  const { makeCdsPrisma } = await import("./cds-fixture");
  return { prisma: makeCdsPrisma() };
});

const TROMBO_ASS = registerRow("uzr-trombo-ass", "Тромбо АСС", "B01AC06", ["Тромбо АСС"]);
const KLOSART = registerRow("uzr-klosart", "КЛОСАРТ®", "C09CA01");
const KARBALEKS = registerRow("uzr-karbaleks", "КАРБАЛЕКС®", "N03AF01");
const DIOKSAFLEKS = registerRow(
  "uzr-dioksafleks",
  "Бетаметазон + гидроксокобаламин + диклофенак",
  null,
  ["ДИОКСАФЛЕКС В12"],
);
const DIKLOFENAK_NATRIYA = registerRow("uzr-diklofenak-natriya", "Диклофенак натрия", null, [
  "Диклофорд",
]);

beforeEach(() => {
  resetCdsState();
  cdsState.register = [TROMBO_ASS, KLOSART, KARBALEKS, DIOKSAFLEKS, DIKLOFENAK_NATRIYA];
});

/** The warnings of a check, without the names, to compare two checks. */
function shape(r: Awaited<ReturnType<typeof check>>) {
  return r.warnings.map((w) => `${w.kind}:${w.severity}:${w.detail}`).sort();
}

describe("register twins give the curated warnings (acceptance)", () => {
  it("«Тромбо АСС» + ibuprofen = aspirin_cardio + ibuprofen", async () => {
    const curated = await check(["aspirin_cardio", "ibuprofen"]);
    const register = await check(["uzr-trombo-ass", "ibuprofen"]);
    expect(curated.warnings.some((w) => w.kind === "INTERACTION")).toBe(true);
    expect(shape(register)).toEqual(shape(curated));
    const w = register.warnings.find((x) => x.kind === "INTERACTION")!;
    // Named as the doctor picked it.
    expect(w.title).toContain("Тромбо АСС");
    expect(register.noInteractionData).toEqual([]);
  });

  it("«КЛОСАРТ» + enalapril = losartan + enalapril (double RAAS block)", async () => {
    const curated = await check(["losartan", "enalapril"]);
    const register = await check(["uzr-klosart", "enalapril"]);
    expect(curated.warnings.some((w) => w.severity === "MAJOR")).toBe(true);
    expect(shape(register)).toEqual(shape(curated));
  });

  it("«КАРБАЛЕКС» carries carbamazepine's pregnancy category and contraindications", async () => {
    cdsState.patient = { birthDate: null, gender: "FEMALE", fullName: "Каримова Дилноза" };
    cdsState.diagnoses = [{ icd10Code: "I44.2", label: "Полная AV-блокада" }];
    const curated = await check(["carbamazepine"]);
    const register = await check(["uzr-karbaleks"]);
    const kinds = (r: typeof curated) =>
      r.warnings.map((w) => `${w.kind}:${w.severity}`).sort();
    expect(kinds(curated)).toEqual(["DIAGNOSIS_RISK:MAJOR", "PREGNANCY:MAJOR"]);
    expect(kinds(register)).toEqual(kinds(curated));
    expect(register.noPregnancyData).toEqual([]);
  });
});

describe("combinations are checked through their components", () => {
  it("«Диоксафлекс B12» + ibuprofen warns about stacking NSAIDs (acceptance)", async () => {
    const r = await check(["uzr-dioksafleks", "ibuprofen"]);
    const w = r.warnings.find(
      (x) =>
        (x.kind === "INTERACTION" || x.kind === "DUPLICATE_CLASS") &&
        [x.drugA.id, x.drugB?.id].includes("uzr-dioksafleks"),
    );
    expect(w, JSON.stringify(r.warnings)).toBeDefined();
    expect(["MODERATE", "MAJOR", "CONTRAINDICATED"]).toContain(w!.severity);
    expect(`${w!.title} ${w!.detail}`).toMatch(/НПВС/);
  });

  it("a combination next to its own component is one substance twice", async () => {
    const r = await check(["uzr-dioksafleks", "diclofenac"]);
    expect(
      r.warnings.some(
        (w) => w.kind === "DUPLICATE_CLASS" && w.title.startsWith("Одно вещество дважды"),
      ),
    ).toBe(true);
  });

  it("an allergy to diclofenac reaches the combination", async () => {
    cdsState.allergies = [
      { id: "a1", substance: "Диклофенак", severity: "SEVERE", reaction: "отёк Квинке" },
    ];
    const r = await check(["uzr-dioksafleks"]);
    const w = r.warnings.find((x) => x.kind === "ALLERGY");
    expect(w?.severity).toBe("CONTRAINDICATED");
    expect(w?.drugA.id).toBe("uzr-dioksafleks");
  });
});

describe("an uncoded register row is the substance its name says", () => {
  it("«Диклофенак натрия» next to «Диклофенак» is one substance twice", async () => {
    const r = await check(["uzr-diklofenak-natriya", "diclofenac"]);
    expect(
      r.warnings.some(
        (w) => w.kind === "DUPLICATE_CLASS" && w.severity === "MAJOR",
      ),
    ).toBe(true);
  });

  it("…with the curated pairs and coverage of diclofenac", async () => {
    const r = await check(["uzr-diklofenak-natriya", "ibuprofen"]);
    expect(r.warnings.some((w) => w.kind === "INTERACTION")).toBe(true);
    expect(r.noInteractionData).toEqual([]);
  });
});

describe("P2 behaviour holds", () => {
  it("a vitamin combination next to one of its vitamins stays quiet", async () => {
    cdsState.register = [
      registerRow("uzr-neyrovit", "Тиамин + пиридоксин + цианокобаламин", "A11DB"),
    ];
    const r = await check(["uzr-neyrovit", "cyanocobalamin"]);
    expect(r.warnings.filter((w) => w.title.startsWith("Одно вещество дважды"))).toEqual([]);
  });

  it("a curated drug keeps its own category over a stricter twin's", async () => {
    // Tofisopam (C) and its register twin: no D from the benzodiazepine
    // table for either.
    cdsState.patient = { birthDate: null, gender: "FEMALE", fullName: "Каримова Дилноза" };
    cdsState.register = [registerRow("uzr-grandaksin", "Грандаксин", "N05BA23")];
    const r = await check(["uzr-grandaksin"]);
    expect(r.warnings.filter((w) => w.kind === "PREGNANCY")).toEqual([]);
  });
});

describe("helpers", () => {
  it("splits combinations and resolves uncoded rows by name", () => {
    expect(combinationParts("Бетаметазон + гидроксокобаламин + диклофенак")).toEqual([
      "Бетаметазон",
      "гидроксокобаламин",
      "диклофенак",
    ]);
    expect(combinationParts("Диклофенак")).toEqual([]);
    expect(componentNames({ nameRu: "Диклофенак натрия", atcCode: null })).toEqual([
      "Диклофенак натрия",
    ]);
    expect(componentNames({ nameRu: "Диклофенак", atcCode: "M01AB05" })).toEqual([]);
  });

  it("the strictest known category wins", () => {
    expect(strictestCategory(["UNKNOWN", "C", "D"])).toBe("D");
    expect(strictestCategory(["UNKNOWN"])).toBe("UNKNOWN");
  });
});
