/**
 * Clinic request 29.09.2026: a visit has a main diagnosis and up to three
 * more. The drug check took the main code alone, so an epilepsy written as
 * the second diagnosis of a migraine visit let metoclopramide through
 * without a word, and a kidney disease there did not raise the NSAID pair's
 * risk.
 *
 * Pinned (acceptance), on the real engine and curated catalog:
 *   1. A contraindication is found through any visit diagnosis, coded or in
 *      the clinic's own words, and named as a diagnosis of this visit.
 *   2. The curated pairs' riskDiagnoses see every visit code.
 *   3. The main code sent twice (alone and in the list) warns once.
 *   4. A check with the main code only behaves as it always did.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { visitConditions } from "@/server/cds/drug-check";

import { NOW, cdsState, resetCdsState } from "./cds-fixture";

vi.mock("@/lib/prisma", async () => {
  const { makeCdsPrisma } = await import("./cds-fixture");
  return { prisma: makeCdsPrisma() };
});

async function check(
  ids: string[],
  diagnosisCode: string | null,
  visitDiagnoses?: Array<{ code: string | null; name: string | null }>,
) {
  const { runDrugCheck } = await import("@/server/cds/drug-check");
  return runDrugCheck({
    clinicId: "c1",
    patientId: "p1",
    prescriptionLines: [],
    drugIds: ids,
    diagnosisCode,
    visitDiagnoses,
    now: NOW,
  });
}

const risk = (r: Awaited<ReturnType<typeof check>>, id: string) =>
  r.warnings.filter((w) => w.kind === "DIAGNOSIS_RISK" && w.drugA.id === id);

const MIGRAINE = { code: "G43.0", name: "Мигрень без ауры" };

beforeEach(() => resetCdsState());

describe("every diagnosis of the visit is checked (acceptance)", () => {
  it("an epilepsy written as the second diagnosis stops metoclopramide", async () => {
    const r = await check(["metoclopramide"], "G43.0", [
      MIGRAINE,
      { code: "G40.9", name: "Эпилепсия" },
    ]);
    const [w] = risk(r, "metoclopramide");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("MAJOR");
    expect(w!.title).toContain("G40.9");
    expect(w!.detail).toContain("G40.9, диагноз этого визита");
  });

  it("one in the clinic's own words is judged by its words", async () => {
    const r = await check(["metoclopramide"], "G43.0", [
      MIGRAINE,
      { code: null, name: "Эпилепсия" },
    ]);
    expect(risk(r, "metoclopramide").map((w) => w.title)).toEqual([
      "Противопоказан, эпилепсия: Метоклопрамид",
    ]);
  });

  it("a kidney disease among them raises the NSAID pair's risk", async () => {
    const plain = await check(["enalapril", "ibuprofen"], "I10", []);
    expect(plain.warnings.some((w) => w.kind === "DIAGNOSIS_RISK")).toBe(false);
    const withCkd = await check(["enalapril", "ibuprofen"], "I10", [
      { code: "I10", name: "Эссенциальная гипертензия" },
      { code: "N18.3", name: "Хроническая болезнь почек, стадия 3" },
    ]);
    expect(withCkd.warnings.some((w) => w.kind === "DIAGNOSIS_RISK")).toBe(true);
  });

  it("the main code sent twice warns once", async () => {
    const r = await check(["metoclopramide"], "G40.9", [
      { code: "G40.9", name: "Эпилепсия" },
    ]);
    expect(risk(r, "metoclopramide")).toHaveLength(1);
  });

  it("the main code alone behaves as it always did", async () => {
    const before = await check(["metoclopramide"], "G40.9");
    expect(risk(before, "metoclopramide")).toHaveLength(1);
    expect(risk(await check(["metoclopramide"], "G43.0"), "metoclopramide")).toHaveLength(0);
    // The card still counts alongside the visit.
    cdsState.diagnoses = [{ icd10Code: "G40.9", label: "Эпилепсия" }];
    expect(risk(await check(["metoclopramide"], "G43.0", [MIGRAINE]), "metoclopramide"))
      .toHaveLength(1);
  });
});

describe("visitConditions", () => {
  it("main first, each once, words only for an uncoded one", () => {
    expect(
      visitConditions("G43.0", [
        MIGRAINE,
        { code: "g43.0", name: "Мигрень" },
        { code: null, name: "Последствия ЧМТ" },
        { code: " ", name: " " },
      ]),
    ).toEqual([
      { code: "G43.0", label: null, origin: "VISIT" },
      { code: null, label: "Последствия ЧМТ", origin: "VISIT" },
    ]);
    expect(visitConditions(null, [])).toEqual([]);
  });
});
