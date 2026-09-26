/**
 * Audit G4-13 — the pregnancy check skipped ~95% of the catalog (category
 * UNKNOWN on simvastatin, perindopril, phenytoin, every register product)
 * and never ran for a card without sex, which is almost every walk-in.
 *
 * Pinned:
 *   1. A drug the catalog left UNKNOWN takes D/X from its teratogenic class
 *      (ATC or catalog id); a curated category always wins.
 *   2. Female 18–45: simvastatin, perindopril, phenytoin and methotrexate
 *      warn. Sex unknown: the warning still fires, worded «если пациентка
 *      беременна», one step softer. Male: never. One warning per drug.
 *   3. A blank card falls back to the name (patronymic, then surname).
 *   4. Drugs with no category at all come back in `noPregnancyData` for a
 *      patient who may be pregnant, so the card never shows an all-clear.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PREGNANCY_RISK_CLASSES,
  effectivePregnancyCat,
  pregnancyContext,
  sexFromName,
} from "@/server/cds/pregnancy";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

type Cat = "A" | "B" | "C" | "D" | "X" | "UNKNOWN";
type Row = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  pregnancyCat: Cat;
  brands: { name: string }[];
};

// As in the live catalog: extension rows have no ATC and no category,
// register rows have an ATC code and no category.
const CATALOG: Record<string, Row> = Object.fromEntries(
  (
    [
      ["simvastatin", "Simvastatin", "Симвастатин", null, "UNKNOWN"],
      ["perindopril", "Perindopril", "Периндоприл", null, "UNKNOWN"],
      ["phenytoin", "Phenytoin", "Фенитоин", null, "UNKNOWN"],
      ["clonazepam", "Clonazepam", "Клоназепам", null, "UNKNOWN"],
      ["paroxetine", "Paroxetine", "Пароксетин", null, "UNKNOWN"],
      ["uzr-metotreksat", "uzr:metotreksat", "Метотрексат", "L04AX03", "UNKNOWN"],
      ["uzr-izotretinoin", "uzr:izotretinoin", "Изотретиноин", "D10AD04", "UNKNOWN"],
      ["uzr-kandesartan", "uzr:kandesartan", "Кандесартан", "C09CA06", "UNKNOWN"],
      ["atorvastatin", "Atorvastatin", "Аторвастатин", "C10AA05", "X"],
      ["enalapril", "Enalapril", "Эналаприл", "C09AA02", "D"],
      ["tofisopam", "Tofisopam", "Тофизопам", "N05BA23", "C"],
      ["uzr-tofizopam", "uzr:tofizopam", "Тофизопам (реестр)", "N05BA23", "UNKNOWN"],
      ["citicoline", "Citicoline", "Цитиколин", "N06BX06", "C"],
      ["mexidol", "Ethylmethylhydroxypyridine succinate", "Мексидол", "N07XX", "UNKNOWN"],
    ] as const
  ).map(([id, inn, nameRu, atcCode, pregnancyCat]) => [
    id,
    { id, inn, nameRu, atcCode, pregnancyCat, brands: [] } as Row,
  ]),
);

const yearsAgo = (n: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d;
};

const state = {
  patient: { birthDate: null as Date | null, gender: null as "MALE" | "FEMALE" | null, fullName: "" },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    drug: {
      findMany: vi.fn(async (args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args.where?.id?.in;
        return ids ? ids.map((id) => CATALOG[id]).filter(Boolean) : Object.values(CATALOG);
      }),
    },
    patientAllergy: { findMany: vi.fn(async () => []) },
    patient: { findFirst: vi.fn(async () => state.patient) },
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

const pregnancy = (r: Awaited<ReturnType<typeof check>>) =>
  r.warnings.filter((w) => w.kind === "PREGNANCY");

beforeEach(() => {
  state.patient = { birthDate: null, gender: null, fullName: "" };
});

describe("category from the teratogenic class when the catalog is silent", () => {
  it.each([
    ["simvastatin", "X"],
    ["perindopril", "D"],
    ["phenytoin", "D"],
    ["clonazepam", "D"],
    ["paroxetine", "D"],
    ["uzr-metotreksat", "X"],
    ["uzr-izotretinoin", "X"],
    ["uzr-kandesartan", "D"],
    ["mexidol", "UNKNOWN"],
  ])("%s → %s", (id, cat) => {
    expect(effectivePregnancyCat(CATALOG[id]!)).toBe(cat);
  });

  it("a curated category always wins over the class table", () => {
    expect(effectivePregnancyCat(CATALOG.tofisopam!)).toBe("C");
    expect(effectivePregnancyCat(CATALOG.atorvastatin!)).toBe("X");
    // …and the register's twin of tofisopam agrees with the curated row.
    expect(effectivePregnancyCat(CATALOG["uzr-tofizopam"]!)).toBe("UNKNOWN");
  });

  it("every class names its source", () => {
    for (const r of PREGNANCY_RISK_CLASSES) {
      expect(r.source.length).toBeGreaterThan(5);
      expect(r.cls.atc.length + r.cls.ids.length).toBeGreaterThan(0);
    }
  });
});

describe("acceptance: a woman of 30", () => {
  beforeEach(() => {
    state.patient = { birthDate: yearsAgo(30), gender: "FEMALE", fullName: "Каримова Дилноза" };
  });

  it("simvastatin, perindopril, phenytoin and methotrexate all warn", async () => {
    const r = await check(["simvastatin", "perindopril", "phenytoin", "uzr-metotreksat"]);
    const byDrug = Object.fromEntries(pregnancy(r).map((w) => [w.drugA.id, w.severity]));
    expect(byDrug).toEqual({
      simvastatin: "CONTRAINDICATED",
      perindopril: "MAJOR",
      phenytoin: "MAJOR",
      "uzr-metotreksat": "CONTRAINDICATED",
    });
  });

  it("one warning per drug, even when two lines name it", async () => {
    const r = await check(["simvastatin"], ["Симвастатин 20 мг", "Симвастатин 10 мг"]);
    expect(pregnancy(r)).toHaveLength(1);
  });

  it("drugs with no category are named instead of an all-clear", async () => {
    const r = await check(["mexidol", "citicoline"]);
    expect(pregnancy(r)).toEqual([]);
    expect(r.noPregnancyData).toEqual(["mexidol"]);
  });
});

describe("sex not recorded (walk-ins)", () => {
  it("still warns, conditionally and one step softer", async () => {
    // The doctor's «Н 1994»: an initial and a birth year, nothing about sex.
    state.patient = { birthDate: null, gender: null, fullName: "Н 1994" };
    const r = await check(["simvastatin", "perindopril"]);
    const [x, d] = [
      pregnancy(r).find((w) => w.drugA.id === "simvastatin")!,
      pregnancy(r).find((w) => w.drugA.id === "perindopril")!,
    ];
    expect(x.severity).toBe("MAJOR");
    expect(d.severity).toBe("MODERATE");
    for (const w of [x, d]) {
      expect(w.title).toMatch(/^Если пациентка беременна/);
      expect(w.detail).toMatch(/Если пациентка беременна/);
      expect(`${w.title} ${w.detail}`).not.toMatch(/[–—]/);
    }
    expect(r.noPregnancyData).toEqual([]);
  });

  it("a blank card with a female name is treated as female", async () => {
    state.patient = { birthDate: null, gender: null, fullName: "Каримова Дилноза Рустамовна" };
    const r = await check(["simvastatin"]);
    expect(pregnancy(r)[0]?.severity).toBe("CONTRAINDICATED");
  });

  it("a blank card with a male name gets no pregnancy warning", async () => {
    state.patient = { birthDate: null, gender: null, fullName: "Турматов О 1969" };
    const r = await check(["simvastatin", "mexidol"]);
    expect(pregnancy(r)).toEqual([]);
    expect(r.noPregnancyData).toEqual([]);
  });
});

describe("never for a man or outside the fertile age", () => {
  it("male", async () => {
    state.patient = { birthDate: yearsAgo(30), gender: "MALE", fullName: "Каримова" };
    const r = await check(["simvastatin", "uzr-metotreksat", "mexidol"]);
    expect(pregnancy(r)).toEqual([]);
    expect(r.noPregnancyData).toEqual([]);
  });

  it("a woman of 60", async () => {
    state.patient = { birthDate: yearsAgo(60), gender: "FEMALE", fullName: "" };
    const r = await check(["simvastatin"]);
    expect(pregnancy(r)).toEqual([]);
  });

  it("a stated sex beats the name", () => {
    expect(
      pregnancyContext({ gender: "MALE", birthDate: null, fullName: "Каримова Дилноза" }),
    ).toBe("NONE");
  });
});

describe("sex from a Russian or Uzbek name", () => {
  it.each([
    ["Каримов Азиз Бахтиёрович", "MALE"],
    ["Каримова Дилноза Рустамовна", "FEMALE"],
    ["Турматов О 1969", "MALE"],
    ["Турматова О 1969", "FEMALE"],
    ["Rustamova Dilnoza", "FEMALE"],
    ["Aliyev Jasur Rustam o‘g‘li", "MALE"],
    ["Karimova Nodira Rustam qizi", "FEMALE"],
    ["Сосновская Анна", "FEMALE"],
  ])("%s → %s", (name, sex) => {
    expect(sexFromName(name)).toBe(sex);
  });

  it.each([
    ["Ходкевич Анна"],
    ["Дилноза"],
    ["Н 1994"],
    ["Каримов Дилноза Рустамовна Ходкевич"],
    [""],
  ])("%s → unknown or female, never a guessed male", (name) => {
    expect(sexFromName(name)).not.toBe("MALE");
  });
});

describe("the card's «нет данных о беременности» note", () => {
  it("exists in both languages without dashes", () => {
    for (const m of [ru, uz]) {
      const cds = (m as unknown as { doctor: { reception: { cds: Record<string, string> } } })
        .doctor.reception.cds;
      expect(cds.noPregnancyData).toContain("{names}");
      expect(cds.noPregnancyDataHint).toBeTruthy();
      expect(`${cds.noPregnancyData} ${cds.noPregnancyDataHint}`).not.toMatch(/[–—]/);
    }
  });
});
