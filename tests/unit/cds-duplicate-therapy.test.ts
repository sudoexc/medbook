/**
 * Audit G4-12 — «Один класс ATC» fired on standard polytherapy (lamotrigine
 * + levetiracetam, piracetam + citicoline: WHO's residual X groups) and
 * missed real duplicates (two benzodiazepines, two NSAIDs from different
 * subgroups, the same substance on two lines, a combination next to its own
 * component).
 *
 * Pinned:
 *   1. Residual groups ending in X never make a duplicate on their own.
 *   2. Curated classes bridge ATC subgroups and ATC-less extension rows:
 *      two NSAIDs, two benzodiazepines, two triptans still warn.
 *   3. «Ибупрофен 400 мг» + «Нурофен 200 мг» warn «одно вещество дважды»;
 *      the same name on two lines (a split dose) does not. This holds for
 *      catalog-picked rows too, the usual way doctors prescribe: two rows of
 *      one id under different labels warn, the same label twice does not.
 *   4. «Лозартан» + «Гидрохлоротиазид + лозартан» warn.
 */
import { describe, expect, it, vi } from "vitest";

import {
  shareSubstance,
  sharedDuplicateClass,
} from "@/server/cds/duplicate-therapy";

type Row = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  pregnancyCat: "A" | "B" | "C" | "D" | "X" | "UNKNOWN";
  brands: { name: string }[];
};

const CATALOG: Record<string, Row> = Object.fromEntries(
  (
    [
      ["lamotrigine", "Lamotrigine", "Ламотриджин", "N03AX09", []],
      ["levetiracetam", "Levetiracetam", "Леветирацетам", "N03AX14", []],
      ["topiramate", "Topiramate", "Топирамат", "N03AX11", []],
      ["piracetam", "Piracetam", "Пирацетам", "N06BX03", []],
      ["citicoline", "Citicoline", "Цитиколин", "N06BX06", []],
      ["phenibut", "phenibut", "Фенибут", "N06BX22", []],
      ["afobazole", "afobazole", "Афобазол", "N05BX04", []],
      ["phenazepam", "phenazepam", "Бромдигидрохлорфенилбензодиазепин", "N05BA", ["Феназепам"]],
      ["diazepam", "Diazepam", "Диазепам", "N05BA01", []],
      ["clonazepam", "Clonazepam", "Клоназепам", null, []],
      ["ibuprofen", "Ibuprofen", "Ибупрофен", "M01AE01", ["Нурофен", "Ибуфен"]],
      ["diclofenac", "Diclofenac", "Диклофенак", "M01AB05", ["Вольтарен"]],
      ["nimesulide", "Nimesulide", "Нимесулид", "M01AX17", ["Найз"]],
      ["uzr-glyukozamin", "uzr:glyukozamin", "Глюкозамин", "M01AX05", []],
      ["sumatriptan", "Sumatriptan", "Суматриптан", "N02CC01", []],
      ["eletriptan", "Eletriptan", "Элетриптан", null, ["Релпакс"]],
      ["carbamazepine", "Carbamazepine", "Карбамазепин", "N03AF01", ["Финлепсин"]],
      ["losartan", "Losartan", "Лозартан", "C09CA01", []],
      ["uzr-gidrokhlorotiazid-lozartan", "uzr:gidrokhlorotiazid-lozartan", "Гидрохлоротиазид + лозартан", "C09DA01", ["Лориста Н"]],
      ["simvastatin", "Simvastatin", "Симвастатин", null, []],
      ["atorvastatin", "Atorvastatin", "Аторвастатин", "C10AA05", []],
      ["warfarin", "Warfarin", "Варфарин", "B01AA03", []],
      ["rivaroxaban", "Rivaroxaban", "Ривароксабан", "B01AF01", []],
      ["paracetamol", "Paracetamol", "Парацетамол", "N02BE01", []],
      ["uzr-teraflu", "uzr:teraflu", "Аскорбиновая кислота + парацетамол + фенирамин", "N02BE51", []],
      ["uzr-natriya-khlorid", "uzr:natriya-khlorid", "Натрия хлорид", "B05XA03", []],
      ["uzr-ringer", "uzr:ringer", "Натрия хлорид + калия хлорид + кальция хлорид", "B05BB01", []],
      ["mexidol", "Ethylmethylhydroxypyridine succinate", "Мексидол", "N07XX", []],
    ] as const
  ).map(([id, inn, nameRu, atcCode, brands]) => [
    id,
    {
      id,
      inn,
      nameRu,
      atcCode,
      pregnancyCat: "C",
      brands: (brands as readonly string[]).map((name) => ({ name })),
    } as Row,
  ]),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    drug: {
      findMany: vi.fn(async (args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args.where?.id?.in;
        return ids ? ids.map((id) => CATALOG[id]).filter(Boolean) : Object.values(CATALOG);
      }),
    },
    patientAllergy: { findMany: vi.fn(async () => []) },
    patient: { findFirst: vi.fn(async () => ({ birthDate: null, gender: "MALE", fullName: "" })) },
    drugInteraction: { findMany: vi.fn(async () => []) },
    appointment: { findFirst: vi.fn(async () => null) },
  },
}));

async function check(ids: string[], lines: string[] = []) {
  const { runDrugCheck } = await import("@/server/cds/drug-check");
  return runDrugCheck({
    clinicId: "c1",
    patientId: "p1",
    prescriptionLines: lines,
    drugIds: ids,
    diagnosisCode: null,
  });
}

/** Structured rows as the constructor sends them: id plus the row label. */
async function checkRows(
  rows: [id: string, displayName: string][],
  lines: string[] = [],
) {
  const { runDrugCheck } = await import("@/server/cds/drug-check");
  return runDrugCheck({
    clinicId: "c1",
    patientId: "p1",
    prescriptionLines: lines,
    drugRows: rows.map(([id, displayName]) => ({ id, displayName })),
    diagnosisCode: null,
  });
}

const dups = (r: Awaited<ReturnType<typeof check>>) =>
  r.warnings.filter((w) => w.kind === "DUPLICATE_CLASS");

describe("residual X groups are not a class", () => {
  it.each([
    ["lamotrigine", "levetiracetam"],
    ["lamotrigine", "topiramate"],
    ["piracetam", "citicoline"],
    ["piracetam", "phenibut"],
    ["phenazepam", "afobazole"],
    ["nimesulide", "uzr-glyukozamin"],
  ])("%s + %s: no duplicate warning", async (a, b) => {
    const r = await check([a, b]);
    expect(dups(r)).toEqual([]);
  });
});

describe("real duplicates still warn", () => {
  it.each([
    ["phenazepam", "diazepam"],
    ["clonazepam", "diazepam"],
  ])("%s + %s: two benzodiazepines", async (a, b) => {
    const r = await check([a, b]);
    // The sedative rule may already have flagged the pair; either way the
    // doctor is told, and only once.
    const aboutPair = r.warnings.filter((w) => w.drugB && [a, b].includes(w.drugB.id));
    expect(aboutPair).toHaveLength(1);
  });

  it.each([
    ["ibuprofen", "diclofenac", "Один класс: НПВС"],
    ["nimesulide", "diclofenac", "Один класс: НПВС"],
    ["eletriptan", "sumatriptan", "Один класс: триптаны"],
    ["simvastatin", "atorvastatin", "Один класс: статины"],
    ["warfarin", "rivaroxaban", "Один класс: антикоагулянты"],
  ])("%s + %s → %s", async (a, b, title) => {
    const r = await check([a, b]);
    expect(dups(r).map((w) => w.title)).toEqual([title]);
    expect(dups(r)[0]!.severity).toBe("MODERATE");
  });

  it("a plain ATC level 4 group still counts", () => {
    expect(
      sharedDuplicateClass(
        { id: "a", inn: "a", nameRu: "A", atcCode: "C03CA01" },
        { id: "b", inn: "b", nameRu: "B", atcCode: "C03CA04" },
      )?.title,
    ).toBe("Один класс ATC: C03CA");
  });
});

describe("one substance twice", () => {
  it("«Ибупрофен 400 мг» + «Нурофен 200 мг»", async () => {
    const r = await check([], ["Ибупрофен 400 мг — 3 раза в день", "Нурофен 200 мг"]);
    const w = dups(r);
    expect(w).toHaveLength(1);
    expect(w[0]!.severity).toBe("MAJOR");
    expect(w[0]!.title).toBe("Одно вещество дважды: Ибупрофен");
    expect(w[0]!.detail).toContain("«Нурофен»");
    expect(w[0]!.detail).not.toMatch(/[–—]/);
  });

  it("a structured row and a text line under a brand", async () => {
    const r = await check(["ibuprofen"], ["Нурофен 200 мг"]);
    expect(dups(r).map((w) => w.title)).toEqual(["Одно вещество дважды: Ибупрофен"]);
  });

  it("two brands of one substance", async () => {
    const r = await check([], ["Нурофен 200 мг", "Ибуфен 100 мг"]);
    expect(dups(r)).toHaveLength(1);
  });

  it("«Лозартан» + «Гидрохлоротиазид + лозартан»", async () => {
    const r = await check(["losartan"], ["Гидрохлоротиазид + лозартан 50/12,5 мг"]);
    const w = dups(r);
    expect(w).toHaveLength(1);
    expect(w[0]!.title).toBe("Одно вещество дважды: Лозартан и Гидрохлоротиазид + лозартан");
    expect(w[0]!.severity).toBe("MAJOR");
  });

  it("paracetamol inside a cold remedy", () => {
    expect(shareSubstance(CATALOG.paracetamol!, CATALOG["uzr-teraflu"]!)).toBe(true);
  });

  it("solutions sharing sodium chloride are not a double dose", () => {
    expect(
      shareSubstance(CATALOG["uzr-natriya-khlorid"]!, CATALOG["uzr-ringer"]!),
    ).toBe(false);
  });

  it("unrelated drugs share nothing", () => {
    expect(shareSubstance(CATALOG.mexidol!, CATALOG.citicoline!)).toBe(false);
    expect(shareSubstance(CATALOG.lamotrigine!, CATALOG.levetiracetam!)).toBe(false);
  });
});

describe("one substance twice on catalog-picked rows", () => {
  it("«Ибупрофен» + «Нурофен (ибупрофен)»: two rows of one id warn", async () => {
    const r = await checkRows([
      ["ibuprofen", "Ибупрофен"],
      ["ibuprofen", "Нурофен (ибупрофен)"],
    ]);
    const w = dups(r);
    expect(w).toHaveLength(1);
    expect(w[0]!.severity).toBe("MAJOR");
    expect(w[0]!.title).toBe("Одно вещество дважды: Ибупрофен");
    expect(w[0]!.detail).toContain("«Ибупрофен»");
    expect(w[0]!.detail).toContain("«Нурофен»");
    expect(w[0]!.detail).not.toMatch(/[–—]/);
    // Still one drug for every other check.
    expect(r.resolvedDrugs.map((d) => d.id)).toEqual(["ibuprofen"]);
  });

  it("two brands of one id warn", async () => {
    const r = await checkRows([
      ["ibuprofen", "Нурофен (ибупрофен)"],
      ["ibuprofen", "Ибуфен (ибупрофен)"],
    ]);
    expect(dups(r).map((w) => w.title)).toEqual(["Одно вещество дважды: Ибупрофен"]);
  });

  it("the same label twice is a split dose", async () => {
    const generic = await checkRows([
      ["carbamazepine", "Карбамазепин"],
      ["carbamazepine", "Карбамазепин"],
    ]);
    expect(dups(generic)).toEqual([]);
    const brand = await checkRows([
      ["ibuprofen", "Нурофен (ибупрофен)"],
      ["ibuprofen", "Нурофен (ибупрофен)"],
    ]);
    expect(dups(brand)).toEqual([]);
  });

  it("a row and a text line under different brands warn", async () => {
    const r = await checkRows([["ibuprofen", "Нурофен (ибупрофен)"]], ["Ибуфен 100 мг"]);
    const w = dups(r);
    expect(w).toHaveLength(1);
    expect(w[0]!.detail).toContain("«Нурофен»");
    expect(w[0]!.detail).toContain("«Ибуфен»");
  });

  it("a row and a text line under the same brand stay silent", async () => {
    const r = await checkRows([["ibuprofen", "Нурофен (ибупрофен)"]], ["Нурофен 200 мг вечером"]);
    expect(dups(r)).toEqual([]);
  });

  it("a label naming none of the drug's names counts as its own name", async () => {
    const r = await checkRows([
      ["ibuprofen", "Ибупрофен"],
      ["ibuprofen", "От головной боли"],
    ]);
    expect(dups(r)).toEqual([]);
  });

  it("bare ids from a page on the previous build still resolve once", async () => {
    const r = await check(["ibuprofen", "ibuprofen"]);
    expect(dups(r)).toEqual([]);
    expect(r.resolvedDrugs.map((d) => d.id)).toEqual(["ibuprofen"]);
  });
});

describe("warning hygiene", () => {
  it("no dash in any duplicate text", async () => {
    const r = await check(["ibuprofen", "diclofenac", "losartan"], [
      "Нурофен 200 мг",
      "Гидрохлоротиазид + лозартан",
    ]);
    expect(dups(r).length).toBeGreaterThan(0);
    for (const w of dups(r)) expect(`${w.title} ${w.detail}`).not.toMatch(/[–—]/);
  });
});
