/**
 * Audit G4-14 — CDS text recognition broke on brands with ®, a hyphen, «+»
 * or brackets («Энап», «Но-шпа», «Витамин D3», «Леводопа + карбидопа»), and
 * a short register name swallowed a longer brand («Лизинокор» → «Лизин»,
 * «Кардилопин» → дилтиазем, «Аскорутин» → «АСК»).
 *
 * Pinned:
 *   1. The line and the index keys share one normaliser (®, ™, quotes, «+»,
 *      «-», brackets, case, ё, Latin/Cyrillic vitamin letters).
 *   2. A key must cover whole words at the start of the line; the longest
 *      key wins across names and brands; a Russian case ending is tolerated.
 *   3. Through the engine: «Энап 10 мг» + «Лозартан 50 мг» both resolve and
 *      the curated enalapril + losartan pair fires.
 */
import { describe, expect, it, vi } from "vitest";

import {
  buildDrugTextIndex,
  drugNameKey,
  matchDrugLine,
} from "@/server/cds/drug-text-match";

type Row = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  pregnancyCat: "A" | "B" | "C" | "D" | "X" | "UNKNOWN";
  brands: { name: string }[];
};

const row = (
  id: string,
  nameRu: string,
  atcCode: string | null,
  brands: string[] = [],
  inn = id,
): Row => ({
  id,
  inn,
  nameRu,
  atcCode,
  pregnancyCat: "UNKNOWN",
  brands: brands.map((name) => ({ name })),
});

// Shapes taken from the live catalog: curated rows, the extension, and the
// register's rows with their slug INNs and upper-case brands.
const CATALOG: Row[] = [
  row("enalapril", "Эналаприл", "C09AA02", ["ЭНАП®", "БЕРЛИПРИЛ®"], "Enalapril"),
  row("losartan", "Лозартан", "C09CA01", ["Лориста"], "Losartan"),
  row("lisinopril", "Лизиноприл", "C09AA03", ["ЛИЗИНОКОР", "Диротон"], "Lisinopril"),
  row("uzr-lizin", "Лизин", "C05CX", [], "uzr:lizin"),
  row("drotaverine", "Дротаверин", "A03AD02", ["Но-шпа"], "Drotaverine"),
  row("levodopa_carbidopa", "Леводопа + карбидопа", "N04BA02", ["Наком"], "Levodopa + Carbidopa"),
  row("levodopa-carbidopa", "Леводопа + Карбидопа", null, ["Синемет"], "Levodopa + Carbidopa"),
  row("vitamin_d3", "Витамин D3 (холекальциферол)", "A11CC05", ["Аквадетрим"]),
  row("colecalciferol", "Колекальциферол (витамин D3)", null, ["Вигантол"]),
  row("cyanocobalamin", "Цианокобаламин (B12)", "B03BA01", [], "Cyanocobalamin"),
  row("uzr-ask", "АСК", "B01AC06", [], "uzr:ask"),
  row("uzr-askorbinovaya-kislota-rutozid", "Аскорбиновая кислота + рутозид", "C05CA51", ["АСКОРУТИН"], "uzr:askorutin"),
  row("diltiazem", "Дилтиазем", null, ["Кардил"], "Diltiazem"),
  row("amlodipine", "Амлодипин", "C08CA01", ["КАРДИЛОПИН", "Норваск"], "Amlodipine"),
  row("uzr-supra", "СУПРА", null, [], "uzr:supra"),
  row("chloropyramine", "Хлоропирамин", "R06AC03", ["Супрастин"], "Chloropyramine"),
  row("carbamazepine", "Карбамазепин", "N03AF01", ["Финлепсин"], "Carbamazepine"),
  row("valproate", "Вальпроевая кислота", "N03AG01", ["Депакин®Хроно", "Депакин"], "Valproic acid"),
  row("ibuprofen", "Ибупрофен", "M01AE01", ["Нурофен"], "Ibuprofen"),
];

const index = buildDrugTextIndex(CATALOG);
const resolve = (line: string) => matchDrugLine(index, line)?.drug.id ?? null;

describe("one normaliser for keys and lines", () => {
  it.each([
    ["ЭНАП®", "энап"],
    ["Но-шпа", "но шпа"],
    ["Леводопа + карбидопа", "леводопа карбидопа"],
    ["Витамин D3 (холекальциферол)", "витамин д3 холекальциферол"],
    ["Витамин Д3", "витамин д3"],
    ["«Лизинокор»", "лизинокор"],
    ["Тёмный™", "темный"],
    ["B12", "в12"],
  ])("%s → %s", (raw, key) => {
    expect(drugNameKey(raw)).toBe(key);
  });
});

describe("acceptance lines from the audit card", () => {
  it.each([
    ["Энап 10 мг", "enalapril"],
    ["Энап 10 мг — по 1 таб 2 раза в день", "enalapril"],
    ["Но-шпа 40 мг", "drotaverine"],
    ["Леводопа + карбидопа 250 мг", "levodopa_carbidopa"],
    ["Витамин D3 2000 МЕ", "vitamin_d3"],
    ["Витамин Д3 2000 МЕ", "vitamin_d3"],
    ["Лизинокор 10 мг", "lisinopril"],
    ["Кардилопин 5 мг", "amlodipine"],
    ["Супрастин 25 мг", "chloropyramine"],
  ])("%s → %s", (line, id) => {
    expect(resolve(line)).toBe(id);
  });

  it("«Аскорутин» is not aspirin", () => {
    expect(resolve("Аскорутин 1 таб")).not.toBe("uzr-ask");
    expect(resolve("Аскорутин 1 таб")).toBe("uzr-askorbinovaya-kislota-rutozid");
  });

  it("a short name still matches as a whole word", () => {
    expect(resolve("АСК 75 мг")).toBe("uzr-ask");
    expect(resolve("Лизин 5 мл")).toBe("uzr-lizin");
    expect(resolve("Кардил 120 мг")).toBe("diltiazem");
  });
});

describe("matching rules", () => {
  it("the longest key wins across names and brands", () => {
    expect(matchDrugLine(index, "Депакин хроно 500 мг")?.label).toBe("Депакин Хроно");
    expect(matchDrugLine(index, "Депакин 300 мг")?.label).toBe("Депакин");
  });

  it("tolerates a Russian case ending on a long enough name", () => {
    expect(resolve("Карбамазепина 200 мг")).toBe("carbamazepine");
    expect(resolve("с Финлепсином")).toBe(null);
    expect(resolve("Финлепсином 200 мг")).toBe("carbamazepine");
  });

  it("strips an ending only from a stem of six letters or more", () => {
    expect(resolve("Лизинокоры 10 мг")).toBe("lisinopril");
    expect(resolve("Лизины 5 мл")).toBe(null);
    expect(resolve("Аспа")).toBe(null);
  });

  it("the INN in Latin still resolves", () => {
    expect(resolve("ibuprofen 400 mg")).toBe("ibuprofen");
  });

  it("on a tie the row with clinical data wins, whatever the row order", () => {
    const reversed = buildDrugTextIndex([...CATALOG].reverse());
    expect(matchDrugLine(reversed, "Леводопа + карбидопа 250 мг")?.drug.id).toBe(
      "levodopa_carbidopa",
    );
    expect(matchDrugLine(reversed, "Витамин D3 2000 МЕ")?.drug.id).toBe("vitamin_d3");
  });

  it("tells a brand from the drug's own name", () => {
    expect(matchDrugLine(index, "Нурофен 200 мг")?.nameKey).toBe("brand:нурофен");
    expect(matchDrugLine(index, "Ибупрофен 400 мг")?.nameKey).toBe("generic");
    expect(matchDrugLine(index, "Ibuprofen 400")?.nameKey).toBe("generic");
  });

  it("an empty or unknown line resolves to nothing", () => {
    expect(resolve("")).toBe(null);
    expect(resolve("— — —")).toBe(null);
    expect(resolve("ЛФК для шейного отдела")).toBe(null);
  });
});

// ── Through the engine ─────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    drug: {
      findMany: vi.fn(async (args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args.where?.id?.in;
        return ids ? CATALOG.filter((d) => ids.includes(d.id)) : CATALOG;
      }),
    },
    patientAllergy: { findMany: vi.fn(async () => []) },
    patient: { findFirst: vi.fn(async () => ({ birthDate: null, gender: "MALE", fullName: "Каримов А" })) },
    drugInteraction: {
      findMany: vi.fn(async (args: { where: { OR: Array<Record<string, { in: string[] }>> } }) => {
        const clause = args.where.OR[0]!;
        const ids = (clause.drugAId ?? clause.drugBId)!.in;
        const pair = {
          drugAId: "enalapril",
          drugBId: "losartan",
          severity: "MAJOR",
          mechanism: "Двойная блокада РААС",
          advice: "Не сочетать",
          riskDiagnoses: [],
          drugA: { id: "enalapril", nameRu: "Эналаприл", inn: "Enalapril" },
          drugB: { id: "losartan", nameRu: "Лозартан", inn: "Losartan" },
        };
        return ids.includes("enalapril") && ids.includes("losartan") ? [pair] : [];
      }),
    },
    appointment: { findFirst: vi.fn(async () => null) },
  },
}));

describe("runDrugCheck on preset text lines", () => {
  it("«Энап 10 мг» + «Лозартан 50 мг»: both resolved, the RAAS pair fires", async () => {
    const { runDrugCheck } = await import("@/server/cds/drug-check");
    const r = await runDrugCheck({
      clinicId: "c1",
      patientId: "p1",
      prescriptionLines: [
        "Энап 10 мг — по 1 таб 2 раза в день",
        "Лозартан 50 мг — по 1 таб утром, длительно",
      ],
      diagnosisCode: null,
    });
    expect(r.unresolvedLines).toEqual([]);
    expect(r.resolvedDrugs.map((d) => d.id)).toEqual(["enalapril", "losartan"]);
    const w = r.warnings.find((x) => x.kind === "INTERACTION");
    expect(w?.title).toBe("Эналаприл + Лозартан");
  });
});
