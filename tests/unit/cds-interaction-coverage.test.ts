/**
 * Audit G4-01 — the CDS interaction base was empty for neurology, and the
 * card showed a green «Конфликтов не найдено» on contraindicated pairs.
 *
 * Pinned:
 *   1. The card's acceptance pairs now warn red or orange (class rules keyed
 *      on ATC / catalog ids, each backed by an SmPC or regulator source).
 *   2. A drug no curated pair and no rule covers is reported in
 *      `noInteractionData`, so the card says «нет данных о взаимодействиях»
 *      instead of an all-clear.
 *   3. Rules never pair a drug with itself; tofisopam is not a sedative
 *      benzodiazepine for the opioid warning.
 *   4. Patient-reported allergies from the pre-visit questionnaire are
 *      checked too (audit G4-02).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTERACTION_RULES,
  findRuleInteractions,
  isCoveredByRules,
} from "@/server/cds/interaction-rules";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

type Row = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  pregnancyCat: "A" | "B" | "C" | "D" | "X" | "UNKNOWN";
  brands: { name: string }[];
};

// Mirrors the static catalog (ATC codes from prisma/_drug-data.ts; the
// «-» rows there have no ATC and are matched by id).
const CATALOG: Record<string, Row> = Object.fromEntries(
  (
    [
      ["tramadol", "Tramadol", "Трамадол", "N02AX02"],
      ["amitriptyline", "Amitriptyline", "Амитриптилин", "N06AA09"],
      ["valproate", "Valproic acid", "Вальпроевая кислота", "N03AG01"],
      ["lamotrigine", "Lamotrigine", "Ламотриджин", "N03AX09"],
      ["tizanidine", "Tizanidine", "Тизанидин", "M03BX02"],
      ["ciprofloxacin", "Ciprofloxacin", "Ципрофлоксацин", "J01MA02"],
      ["sildenafil", "Sildenafil", "Силденафил", "G04BE03"],
      ["nitroglycerin", "Glyceryl trinitrate", "Нитроглицерин", "C01DA02"],
      ["lisinopril", "Lisinopril", "Лизиноприл", "C09AA03"],
      ["spironolactone", "Spironolactone", "Спиронолактон", "C03DA01"],
      ["sertraline", "Sertraline", "Сертралин", "N06AB06"],
      ["sumatriptan", "Sumatriptan", "Суматриптан", "N02CC01"],
      ["zolmitriptan", "Zolmitriptan", "Золмитриптан", null],
      ["fluoxetine", "Fluoxetine", "Флуоксетин", null],
      ["diazepam", "Diazepam", "Диазепам", "N05BA01"],
      ["pregabalin", "Pregabalin", "Прегабалин", "N03AX16"],
      ["tofisopam", "Tofisopam", "Тофизопам", "N05BA23"],
      ["metoclopramide", "Metoclopramide", "Метоклопрамид", "A03FA01"],
      ["levodopa_carbidopa", "Levodopa + Carbidopa", "Леводопа + карбидопа", "N04BA02"],
      ["carbamazepine", "Carbamazepine", "Карбамазепин", "N03AF01"],
      ["clarithromycin", "Clarithromycin", "Кларитромицин", "J01FA09"],
      ["warfarin", "Warfarin", "Варфарин", "B01AA03"],
      ["ibuprofen", "Ibuprofen", "Ибупрофен", "M01AE01"],
      ["amiodarone", "Amiodarone", "Амиодарон", "C01BD01"],
      ["citicoline", "Citicoline", "Цитиколин", "N06BX06"],
      ["mexidol", "Ethylmethylhydroxypyridine succinate", "Мексидол", "N07XX"],
      ["amoxiclav", "Amoxicillin + Clavulanate", "Амоксиклав", "J01CR02"],
    ] as const
  ).map(([id, inn, nameRu, atc]) => [
    id,
    { id, inn, nameRu, atcCode: atc, pregnancyCat: "UNKNOWN", brands: [] } as Row,
  ]),
);

const state = {
  allergies: [] as Array<{ id: string; substance: string; severity: string | null; reaction: string | null }>,
  preVisit: null as unknown,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    drug: {
      findMany: vi.fn(async (args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args.where?.id?.in ?? [];
        return ids.map((id) => CATALOG[id]).filter(Boolean);
      }),
    },
    patientAllergy: { findMany: vi.fn(async () => state.allergies) },
    patient: { findFirst: vi.fn(async () => ({ birthDate: null, gender: "MALE" })) },
    // No curated pairs at all: everything below comes from the class rules.
    drugInteraction: { findMany: vi.fn(async () => []) },
    appointment: {
      findFirst: vi.fn(async () =>
        state.preVisit ? { preVisitData: state.preVisit } : null,
      ),
    },
  },
}));

async function check(ids: string[]) {
  const { runDrugCheck } = await import("@/server/cds/drug-check");
  return runDrugCheck({
    clinicId: "c1",
    patientId: "p1",
    prescriptionLines: [],
    drugIds: ids,
    diagnosisCode: null,
  });
}

beforeEach(() => {
  state.allergies = [];
  state.preVisit = null;
});

const RED_OR_ORANGE = new Set(["MODERATE", "MAJOR", "CONTRAINDICATED"]);

describe("acceptance pairs from the audit card now warn", () => {
  it.each([
    ["tramadol", "amitriptyline", "MAJOR"],
    ["valproate", "lamotrigine", "MAJOR"],
    ["tizanidine", "ciprofloxacin", "CONTRAINDICATED"],
    ["sildenafil", "nitroglycerin", "CONTRAINDICATED"],
    ["lisinopril", "spironolactone", "MODERATE"],
  ])("%s + %s → %s", async (a, b, severity) => {
    const r = await check([a, b]);
    const w = r.warnings.find((x) => x.kind === "INTERACTION");
    expect(w, `${a}+${b}`).toBeDefined();
    expect(w!.severity).toBe(severity);
    expect(RED_OR_ORANGE.has(w!.severity)).toBe(true);
    expect(r.noInteractionData).toEqual([]);
  });

  it.each([
    ["sertraline", "tramadol"],
    ["fluoxetine", "sumatriptan"],
    ["diazepam", "tramadol"],
    ["pregabalin", "tramadol"],
    ["metoclopramide", "levodopa_carbidopa"],
    ["carbamazepine", "clarithromycin"],
    ["warfarin", "ibuprofen"],
    ["warfarin", "amiodarone"],
    ["zolmitriptan", "fluoxetine"],
  ])("%s + %s warns", async (a, b) => {
    const r = await check([a, b]);
    expect(r.warnings.some((x) => x.kind === "INTERACTION")).toBe(true);
  });
});

describe("honest coverage: no all-clear without data", () => {
  it("names drugs the interaction base knows nothing about", async () => {
    const r = await check(["citicoline", "mexidol"]);
    expect(r.warnings).toEqual([]);
    expect(r.noInteractionData.sort()).toEqual(["citicoline", "mexidol"]);
  });

  it("a covered pair without a conflict is a real all-clear", async () => {
    const r = await check(["lamotrigine", "sumatriptan"]);
    expect(r.warnings).toEqual([]);
    expect(r.noInteractionData).toEqual([]);
  });

  it("the card has the «нет данных» text in both languages", () => {
    const ruCds = (ru as unknown as { doctor: { reception: { cds: Record<string, string> } } }).doctor.reception.cds;
    const uzCds = (uz as unknown as { doctor: { reception: { cds: Record<string, string> } } }).doctor.reception.cds;
    expect(ruCds.noInteractionData).toMatch(/Нет данных о взаимодействиях/);
    expect(uzCds.noInteractionData).toContain("{names}");
    expect(ruCds.noInteractionDataHint).toBeTruthy();
    expect(uzCds.noInteractionDataHint).toBeTruthy();
  });
});

describe("rule hygiene", () => {
  it("every rule names a source and has no dash in doctor-facing text", () => {
    for (const r of INTERACTION_RULES) {
      expect(r.source.length, r.key).toBeGreaterThan(5);
      expect(`${r.mechanism} ${r.advice}`, r.key).not.toMatch(/[–—]/);
    }
  });

  it("never pairs a drug with itself, even for same-class rules", () => {
    const hits = findRuleInteractions([
      { id: "sertraline", atcCode: "N06AB06" },
      { id: "sertraline", atcCode: "N06AB06" },
    ]);
    expect(hits).toEqual([]);
  });

  it("tofisopam is kept out of the sedative benzodiazepine warnings", () => {
    const hits = findRuleInteractions([
      { id: "tofisopam", atcCode: "N05BA23" },
      { id: "tramadol", atcCode: "N02AX02" },
    ]);
    expect(hits).toEqual([]);
    expect(isCoveredByRules({ id: "tofisopam", atcCode: "N05BA23" })).toBe(false);
  });

  it("covers registry products through their ATC code", () => {
    // A registry tramadol has a «uzr-…» id but the same ATC code.
    const hits = findRuleInteractions([
      { id: "uzr-tramadol-xyz", atcCode: "N02AX02" },
      { id: "uzr-amitriptilin", atcCode: "N06AA09" },
    ]);
    expect(hits.map((h) => h.rule.key)).toContain("tramadol+serotonergic-ad");
  });
});

describe("pre-visit questionnaire allergies (G4-02)", () => {
  it("a patient-reported «пенициллин» warns on Амоксиклав", async () => {
    state.preVisit = {
      complaints: "головная боль",
      allergies: ["пенициллин"],
      medications: [],
      notes: "",
      locale: "ru",
    };
    const r = await check(["amoxiclav"]);
    const w = r.warnings.find((x) => x.kind === "ALLERGY");
    expect(w).toBeDefined();
    expect(w!.title).toContain("со слов пациента");
    expect(w!.severity).toBe("MAJOR");
  });

  it("a recorded food allergy «мед» stays silent", async () => {
    state.allergies = [{ id: "a1", substance: "мед", severity: "SEVERE", reaction: "сыпь" }];
    const r = await check(["amoxiclav", "warfarin"]);
    expect(r.warnings.filter((x) => x.kind === "ALLERGY")).toEqual([]);
  });
});
