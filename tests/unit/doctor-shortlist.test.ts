import { describe, expect, it } from "vitest";

import {
  buildDiagnosisShortlist,
  buildDrugShortlist,
  hasStaleDrugUse,
  repinDrugUses,
  type StructuredDrugUse,
} from "@/server/catalog/shortlist";
import { buildDrugTextIndex } from "@/server/cds/drug-text-match";
import { matchAllergy } from "@/server/cds/allergy-match";
import {
  formularyBrands,
  formularySearchText,
  normalizeCatalogTerm,
  stripDoseFromName,
} from "@/server/catalog/formulary";

/**
 * «Мои частые» — the clinic asked that tapping the diagnosis or drug field
 * show THIS doctor's usual picks (one lives on migraine, another on
 * lumbago), starred ones first, everything else behind search.
 */

const d = (iso: string) => new Date(iso);

describe("buildDiagnosisShortlist", () => {
  const nameForCode = (code: string) =>
    ({ "G43.0": "Мигрень без ауры", "M54.4": "Люмбаго с ишиасом" })[code] ?? null;

  it("ranks by how often he writes it, one row per ICD code", () => {
    const rows = buildDiagnosisShortlist({
      pinnedCodes: [],
      uses: [
        { code: "G44.2", name: "Головная боль напряженного типа", at: d("2026-09-01") },
        { code: "G44.2", name: "Головная боль напряжения", at: d("2026-09-20") },
        { code: "g44.2", name: "Головная боль напряженного типа", at: d("2026-09-02") },
        { code: "F48.0", name: "Неврастения", at: d("2026-09-10") },
      ],
      nameForCode,
      limit: 10,
    });
    expect(rows.map((r) => [r.code, r.count])).toEqual([
      ["G44.2", 3],
      ["F48.0", 1],
    ]);
    // The newest wording for the code is the one offered.
    expect(rows[0].name).toBe("Головная боль напряжения");
  });

  it("groups free-text diagnoses by wording, case and ё-insensitively", () => {
    const rows = buildDiagnosisShortlist({
      pinnedCodes: [],
      uses: [
        { code: null, name: "тиннитус", at: d("2026-09-01") },
        { code: null, name: "Тиннитус ", at: d("2026-09-02") },
        { code: null, name: "  ", at: d("2026-09-03") },
        { code: null, name: null, at: d("2026-09-03") },
      ],
      nameForCode,
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: null, count: 2, pinned: false });
  });

  it("puts starred codes first, even ones he never used, in his order", () => {
    const rows = buildDiagnosisShortlist({
      pinnedCodes: ["M54.4", "G43.0"],
      uses: [
        { code: "F48.0", name: "Неврастения", at: d("2026-09-10") },
        { code: "F48.0", name: "Неврастения", at: d("2026-09-11") },
        { code: "G43.0", name: "Мигрень без ауры [простая]", at: d("2026-09-12") },
      ],
      nameForCode,
      limit: 10,
    });
    expect(rows.map((r) => [r.code, r.pinned, r.count])).toEqual([
      ["M54.4", true, 0],
      ["G43.0", true, 1],
      ["F48.0", false, 2],
    ]);
    // A used starred code keeps the doctor's own wording.
    expect(rows[1].name).toBe("Мигрень без ауры [простая]");
  });

  it("drops a starred code nobody can name, and caps the unstarred tail", () => {
    const uses = Array.from({ length: 20 }, (_, i) => ({
      code: `R${10 + i}`,
      name: `Диагноз ${i}`,
      at: d("2026-09-01"),
    }));
    const rows = buildDiagnosisShortlist({
      pinnedCodes: ["Z99.9"],
      uses,
      nameForCode,
      limit: 12,
    });
    expect(rows).toHaveLength(12);
    expect(rows.some((r) => r.code === "Z99.9")).toBe(false);
  });
});

describe("stars never hide the history", () => {
  it("keeps his five most-written diagnoses after fifteen starred codes", () => {
    const pinnedCodes = Array.from({ length: 15 }, (_, i) => `G${40 + i}`);
    const uses = Array.from({ length: 8 }, (_, i) => ({
      code: `M${50 + i}`,
      name: `Дорсопатия ${i}`,
      at: d("2026-09-01"),
    }));
    const rows = buildDiagnosisShortlist({
      pinnedCodes,
      uses,
      nameForCode: (c) => `Диагноз ${c}`,
      limit: 12,
    });
    expect(rows.filter((r) => r.pinned)).toHaveLength(15);
    expect(rows.filter((r) => !r.pinned)).toHaveLength(5);
  });
});

describe("buildDrugShortlist", () => {
  it("groups structured rows by drug and keeps the newest label and dose", () => {
    const rows = buildDrugShortlist({
      pinnedIds: [],
      structured: [
        { drugId: "tolperisone", displayName: "Толперизон", dose: "50 мг", at: d("2026-09-01") },
        { drugId: "tolperisone", displayName: "Мидокалм (толперизон)", dose: "150 мг", at: d("2026-09-20") },
        { drugId: "nimesulide", displayName: "Найз", dose: null, at: d("2026-09-05") },
      ],
      freeText: [],
      limit: 10,
    });
    expect(rows[0]).toMatchObject({
      drugId: "tolperisone",
      label: "Мидокалм (толперизон)",
      lastDose: "150 мг",
      count: 2,
    });
    expect(rows[1]).toMatchObject({ drugId: "nimesulide", count: 1 });
  });

  it("counts free-typed lines too, grouped by wording", () => {
    const rows = buildDrugShortlist({
      pinnedIds: [],
      structured: [],
      freeText: [
        { line: "Магне B6 — по 2 таб 2 раза в день", at: d("2026-09-01") },
        { line: "магне b6 — по 2 таб 2 раза в день", at: d("2026-09-02") },
      ],
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ drugId: null, count: 2 });
    expect(rows[0].key.startsWith("text:")).toBe(true);
  });

  it("puts starred drugs first; an unused star waits for its catalog label", () => {
    const rows = buildDrugShortlist({
      pinnedIds: ["sumatriptan", "tolperisone"],
      structured: [
        { drugId: "nimesulide", displayName: "Найз", dose: null, at: d("2026-09-05") },
        { drugId: "nimesulide", displayName: "Найз", dose: null, at: d("2026-09-06") },
        { drugId: "tolperisone", displayName: "Мидокалм", dose: null, at: d("2026-09-07") },
      ],
      freeText: [],
      limit: 10,
    });
    expect(rows.map((r) => [r.key, r.pinned])).toEqual([
      ["sumatriptan", true],
      ["tolperisone", true],
      ["nimesulide", false],
    ]);
    expect(rows[0].label).toBe("");
    expect(rows[1].label).toBe("Мидокалм");
  });
});

/**
 * Review of CT-03: fix-ct03 moves МИОСПАН (lidocaine + tolperisone) off the
 * tolperisone row, but the doctor's history still has rows pinned to
 * tolperisone under «МИОСПАН (толперизон)». The shortlist is built from that
 * history by drugId, and a tap on it pinned the new row to tolperisone again:
 * the CDS check reads pinned rows by id, so a lidocaine allergy stayed silent.
 */
describe("shortlist after a brand moved to its own row (CT-03 review)", () => {
  // The live catalog after `fix-ct03-registry-brand-homes.ts` ran.
  const tolperisone = {
    id: "tolperisone",
    inn: "Tolperisone",
    nameRu: "Толперизон",
    atcCode: "M03BX04",
    brands: [{ name: "Мидокалм" }, { name: "Калмирекс" }, { name: "ТОЛКИМАДО" }],
  };
  const combo = {
    id: "uzr-lidokain-tolperizon",
    inn: "uzr:lidokain-tolperizon",
    nameRu: "Лидокаин + толперизон",
    atcCode: "M03BX54",
    brands: [{ name: "МИОСПАН" }, { name: "МИОФЛЕКС" }, { name: "ТОЛКИМАДО" }],
  };
  const propranolol = {
    id: "propranolol",
    inn: "Propranolol",
    nameRu: "Пропранолол",
    atcCode: "C07AA05",
    // «Анаприлин» only as the clinic's core-list name, added by the route.
    brands: [{ name: "Анаприлин (пропранолол)" }],
  };
  const catalog = buildDrugTextIndex([tolperisone, combo, propranolol]);
  const current = new Map([tolperisone, combo, propranolol].map((x) => [x.id, x]));
  const use = (drugId: string | null, displayName: string, at: string): StructuredDrugUse => ({
    drugId,
    displayName,
    dose: "1 амп",
    at: d(at),
  });

  it("pins a «МИОСПАН (толперизон)» use to the combination row", () => {
    const history = [use("tolperisone", "МИОСПАН (толперизон)", "2026-09-10")];
    expect(hasStaleDrugUse(history, current)).toBe(true);
    const [moved] = repinDrugUses({ uses: history, current, catalog });
    expect(moved).toMatchObject({
      drugId: "uzr-lidokain-tolperizon",
      displayName: "МИОСПАН (лидокаин + толперизон)",
      dose: "1 амп",
    });
  });

  it("offers one row for old and new Миоспан uses, apart from plain tolperisone", () => {
    const history = [
      use("tolperisone", "Миоспан (толперизон)", "2026-09-01"),
      use("tolperisone", "МИОСПАН (толперизон)", "2026-09-10"),
      use("uzr-lidokain-tolperizon", "МИОСПАН (лидокаин + толперизон)", "2026-09-27"),
      use("tolperisone", "Мидокалм (толперизон)", "2026-09-20"),
    ];
    const rows = buildDrugShortlist({
      pinnedIds: [],
      structured: repinDrugUses({ uses: history, current, catalog }),
      freeText: [],
      limit: 10,
    });
    expect(rows.map((r) => [r.drugId, r.count, r.label])).toEqual([
      ["uzr-lidokain-tolperizon", 3, "МИОСПАН (лидокаин + толперизон)"],
      ["tolperisone", 1, "Мидокалм (толперизон)"],
    ]);
    // What the tap pins is what the allergy check reads: the old pin could
    // never warn about lidocaine, the new one does.
    const asAllergyDrug = (x: typeof combo) => ({
      ...x,
      brandNames: x.brands.map((b) => b.name),
    });
    expect(matchAllergy("лидокаин", asAllergyDrug(tolperisone))).toBeNull();
    expect(matchAllergy("лидокаин", asAllergyDrug(combo))).toEqual({ kind: "SUBSTANCE" });
  });

  it("leaves a label that still names its drug where it is", () => {
    const history = [
      use("tolperisone", "Толперизон", "2026-09-01"),
      use("tolperisone", "Мидокалм (толперизон)", "2026-09-02"),
      // Registered for both compositions: the doctor's pick stands.
      use("tolperisone", "ТОЛКИМАДО (толперизон)", "2026-09-03"),
      // The clinic's own name for the drug.
      use("propranolol", "Анаприлин (пропранолол)", "2026-09-04"),
      use(null, "Магне B6", "2026-09-05"),
    ];
    expect(hasStaleDrugUse(history, current)).toBe(false);
    expect(repinDrugUses({ uses: history, current, catalog })).toEqual(history);
  });

  it("keeps the pin when the catalog cannot place the label anywhere", () => {
    // His own wording of the drug he picked: nothing better to follow.
    const history = [use("tolperisone", "Уколы от спины", "2026-09-01")];
    expect(repinDrugUses({ uses: history, current, catalog })).toEqual(history);
  });

  it("leaves a use alone when its drug is gone from the catalog", () => {
    const history = [use("retired-drug", "МИОСПАН (толперизон)", "2026-09-01")];
    expect(hasStaleDrugUse(history, current)).toBe(false);
    expect(repinDrugUses({ uses: history, current, catalog })).toEqual(history);
  });
});

describe("clinic core list helpers", () => {
  it("normalises search keys the same way for label and aliases", () => {
    expect(normalizeCatalogTerm("  Тидомёт   ФОРТЕ ")).toBe("тидомет форте");
    const text = formularySearchText("Летирам", ["Кеппра"]);
    expect(text.includes("летирам")).toBe(true);
    expect(text.includes("кеппра")).toBe(true);
  });

  it("exposes the clinic's names as brands, label first", () => {
    const brands = formularyBrands({
      drugId: "levetiracetam",
      label: "Летирам",
      aliases: ["Кеппра"],
    });
    expect(brands.map((b) => b.name)).toEqual(["Летирам", "Кеппра"]);
    expect(new Set(brands.map((b) => b.id)).size).toBe(2);
  });
});

describe("stripDoseFromName", () => {
  it("drops the dose a doctor types after a brand", () => {
    expect(stripDoseFromName("Конкор 5")).toBe("Конкор");
    expect(stripDoseFromName("Кеторол 10 мг")).toBe("Кеторол");
    expect(stripDoseFromName("Амоксиклав 875/125")).toBe("Амоксиклав");
    expect(stripDoseFromName("Мексидол 5,0 №10")).toBe("Мексидол");
    expect(stripDoseFromName("Мидокалм 150мг")).toBe("Мидокалм");
  });

  it("keeps names that are words, including ones with digits inside", () => {
    expect(stripDoseFromName("Блокиум В12")).toBe("Блокиум В12");
    expect(stripDoseFromName("Нуклео ЦМФ")).toBe("Нуклео ЦМФ");
    expect(stripDoseFromName("Магне B6")).toBe("Магне B6");
  });
});
