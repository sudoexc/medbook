/**
 * Drug search typed the way doctors type (production, 30.09.2026, doctor
 * account): «аспирин» found 3 rows but «аспирин с» and «аспирин c» (Latin
 * c) found none, the brand being «АСПИРИН® С»; «токката» found 2 but
 * «токката рапид» none («Токката® рапид»); «магне b6» found 3 but «магне
 * в6» (Cyrillic В) none. The route matched the whole typed string with one
 * `contains`, so a ® or a lookalike letter between the words broke it.
 *
 * Run against the real state register (with its composition fixes, as
 * production holds it) in a small in-memory stand-in for Prisma, and
 * through the same fold in the ranking, the prescription label, the
 * clinic's core list, the CDS text matcher and the ICD search.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import registry from "../../prisma/uzpharm-registry.json";
import { DRUGS as DRUGS_CORE } from "../../prisma/_drug-catalog";
import { DRUGS_EXTRA } from "../../prisma/_drug-catalog-extra";
import {
  correctRegisterEntities,
  type RegistryEntity,
} from "../../scripts/_registry-plan";
import {
  catalogSearchWords,
  catalogWordIdVariants,
  catalogWordVariants,
  foldCatalogPlain,
  foldCatalogText,
  foldMixedWords,
} from "@/lib/catalogs/search-fold";
import { matchedBrand, prescriptionLabel } from "@/lib/catalogs/brand-match";
import { rankDrugMatch } from "@/server/catalog/drug-rank";
import { buildDrugShortlist } from "@/server/catalog/shortlist";
import {
  buildDrugTextIndex,
  drugNameKey,
  matchDrugLine,
} from "@/server/cds/drug-text-match";
import { icdQueryTerms, searchIcd10 } from "@/server/icd10/search";

type Row = {
  id: string;
  inn: string;
  nameRu: string;
  nameUz: string | null;
  atcCode: string | null;
  category: string;
  forms: unknown;
  indications: string[];
  rxOnly: boolean;
  active: boolean;
  photoUrl: string | null;
  defaultDosing: unknown;
  clinicId: string | null;
  brands: { id: string; name: string; manufacturer: string | null }[];
};

function drug(
  p: Partial<Row> & Pick<Row, "id" | "nameRu"> & { brandNames?: string[] },
): Row {
  const { brandNames, ...rest } = p;
  return {
    inn: p.id,
    nameUz: null,
    atcCode: null,
    category: "OTHER",
    forms: [],
    indications: [],
    rxOnly: true,
    active: true,
    photoUrl: null,
    defaultDosing: null,
    clinicId: null,
    brands: (brandNames ?? []).map((name, i) => ({
      id: `${p.id}:${i}`,
      name,
      manufacturer: null,
    })),
    ...rest,
  };
}

const REGISTRY: Row[] = correctRegisterEntities(
  (registry as unknown as { entities: RegistryEntity[] }).entities,
).map((e) =>
  drug({
    id: e.id,
    inn: e.inn,
    nameRu: e.nameRu,
    atcCode: e.atcCode,
    category: e.category,
    brandNames: e.brands.map((b) => b.name),
  }),
);

// The curated rows production carries next to the register.
const CURATED: Row[] = [
  drug({ id: "aspirin", inn: "Acetylsalicylic acid", nameRu: "Ацетилсалициловая кислота", atcCode: "N02BA01", brandNames: ["Аспирин"] }),
  drug({ id: "magnesium_b6", inn: "Magnesium/Pyridoxine", nameRu: "Магний B6", atcCode: "A12CC30", brandNames: ["Магне B6"] }),
  drug({ id: "paracetamol", inn: "Paracetamol", nameRu: "Парацетамол", atcCode: "N02BE01" }),
];

// The whole curated seed, as prisma/seed-drugs.ts writes it: Latin slug ids
// and INNs («hopantenic-acid», «Topiramate»), where a lookalike fold misleads.
const CURATED_SEED: Row[] = [...DRUGS_CORE, ...DRUGS_EXTRA].map((d) =>
  drug({
    id: d.id,
    inn: d.intl ?? d.id,
    nameRu: d.nameRu,
    nameUz: d.nameUz ?? null,
    brandNames: d.brands ?? [],
  }),
);

const ASPIRIN_C = "uzr-atsetilsalitsilovaya-kislota-askorbinovaya-kislota";
const TOKKATA_RAPID = "uzr-lidokain-tolperizon";

// ── A small Prisma stand-in: the filters these routes use ─────────────────
type Where = Record<string, unknown>;

function fieldMatches(val: unknown, f: Record<string, unknown>): boolean {
  const ci = f.mode === "insensitive";
  const norm = (x: unknown) => (ci ? String(x).toLowerCase() : String(x));
  if ("in" in f) return (f.in as unknown[]).includes(val);
  if ("notIn" in f) return !(f.notIn as unknown[]).includes(val);
  if ("contains" in f) return val != null && norm(val).includes(norm(f.contains));
  if ("startsWith" in f) {
    return val != null && norm(val).startsWith(norm(f.startsWith));
  }
  throw new Error(`fake prisma: unsupported filter ${JSON.stringify(f)}`);
}

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "AND") return (v as Where[]).every((w) => matches(row, w));
    if (k === "OR") return (v as Where[]).some((w) => matches(row, w));
    if (k === "NOT") {
      return !(Array.isArray(v) ? v : [v]).some((w) => matches(row, w as Where));
    }
    if (k === "brands") {
      const some = (v as { some: Where }).some;
      return (row.brands as Record<string, unknown>[]).some((b) => matches(b, some));
    }
    const val = row[k];
    if (v === null) return val === null || val === undefined;
    if (typeof v !== "object") return val === v;
    return fieldMatches(val, v as Record<string, unknown>);
  });
}

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  formulary: [] as Record<string, unknown>[],
}));

function findMany(
  table: Record<string, unknown>[],
  args: { where?: Where; orderBy?: unknown; skip?: number; take?: number },
) {
  let out = table.filter((r) => matches(r, args.where ?? {}));
  if (args.orderBy) {
    out = [...out].sort((a, b) =>
      "sortOrder" in a
        ? Number(a.sortOrder) - Number(b.sortOrder)
        : String(a.nameRu).localeCompare(String(b.nameRu), "ru"),
    );
  }
  const skip = args.skip ?? 0;
  return out.slice(skip, args.take !== undefined ? skip + args.take : undefined);
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    drug: {
      findMany: vi.fn(async (a: Parameters<typeof findMany>[1]) => findMany(db.rows, a)),
      count: vi.fn(async (a: { where: Where }) => findMany(db.rows, a).length),
    },
    clinicFormularyDrug: {
      findMany: vi.fn(async (a: Parameters<typeof findMany>[1]) =>
        findMany(db.formulary, a),
      ),
    },
  },
}));

vi.mock("@/lib/api-handler", () => ({
  createApiListHandler:
    (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({
        request,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: "DOCTOR" },
      }),
}));

vi.mock("@/server/catalog/clinic-overlay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/catalog/clinic-overlay")>()),
  loadClinicOverlays: vi.fn(async () => ({ hidden: new Set(), overrides: new Map() })),
}));

import { GET as listDrugs } from "@/app/api/crm/catalogs/drugs/route";
import { formularySearchText, searchFormulary } from "@/server/catalog/formulary";
import { resolveLineDrugIds } from "@/server/visit-notes/legacy-line-drugs";

type ListBody = { rows: Row[]; total: number };

async function search(q: string, limit = 12): Promise<ListBody> {
  const url = new URL("http://x/api/crm/catalogs/drugs");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  const res = await listDrugs(new Request(url));
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
}

const ids = (b: ListBody) => b.rows.map((r) => r.id).sort();

beforeEach(() => {
  db.rows = [...REGISTRY, ...CURATED];
  db.formulary = [];
});

// ── The fold itself ───────────────────────────────────────────────────────

describe("search-fold", () => {
  it.each([
    ["АСПИРИН® С", "аспирин с"],
    ["Аспирин C", "аспирин с"],
    ["Токката® рапид", "токката рапид"],
    ["МАГНЕ® B6", "магне в6"],
    ["Магне В6", "магне в6"],
    ["«Депакин®Хроно»", "депакин хроно"],
    ["Тёмный™ ©", "темный"],
    ["Но-шпа", "но шпа"],
  ])("%s → %s", (raw, key) => {
    expect(foldCatalogText(raw)).toBe(key);
  });

  it("keeps an Uzbek word whole whichever apostrophe was typed", () => {
    expect(foldCatalogText("o‘g‘il")).toBe(foldCatalogText("o'g'il"));
    expect(foldCatalogText("o‘g‘il")).not.toContain(" ");
  });

  it("splits a query into words the database can find, marks and «+» dropped", () => {
    expect(catalogSearchWords("АСПИРИН® С")).toEqual(["аспирин", "с"]);
    expect(catalogSearchWords("парацетамол + кофеин")).toEqual(["парацетамол", "кофеин"]);
    expect(catalogSearchWords(" ® + ")).toEqual([]);
  });

  it("spells a word the ways the catalog may hold it, and only those", () => {
    expect(catalogWordVariants("в6").sort()).toEqual(["b6", "в6"]);
    expect(catalogWordVariants("b6").sort()).toEqual(["b6", "в6"]);
    expect(catalogWordVariants("c").sort()).toEqual(["c", "с"]);
    expect(catalogWordVariants("с").sort()).toEqual(["c", "с"]);
    expect(catalogWordVariants("аспирин")).toEqual(["аспирин"]);
    expect(catalogWordVariants("magne")).toEqual(["magne"]);
    expect(catalogWordVariants("ёд")).toEqual(["ёд", "ед"]);
  });

  it("re-spells only a letter or a letter with digits, never a whole word", () => {
    // «нор» is not «hop», «тор» not «top», «вер» not «bep»: in Latin those
    // letters are other sounds.
    for (const w of ["нор", "тор", "вер", "ра", "ас", "ре"]) {
      expect(catalogWordVariants(w)).toEqual([w]);
    }
    expect(catalogWordVariants("top")).toEqual(["top"]);
    expect(catalogWordVariants("в12").sort()).toEqual(["b12", "в12"]);
    // A word that mixes alphabets was a slip: both single-alphabet forms.
    expect(catalogWordVariants("тoр")).toEqual(expect.arrayContaining(["тор", "top"]));
  });

  it("never spells a Cyrillic word in Latin for an id or an INN", () => {
    expect(catalogWordIdVariants("с")).toEqual(["с"]);
    expect(catalogWordIdVariants("в6")).toEqual(["в6"]);
    expect(catalogWordIdVariants("b6").sort()).toEqual(["b6", "в6"]);
    expect(catalogWordIdVariants("pаracetamol")).toContain("paracetamol");
  });

  it("keeps the alphabet in the plain key used for ids and INNs", () => {
    expect(foldCatalogPlain("hopantenic-acid")).toBe("hopantenic acid");
    expect(foldCatalogPlain("МАГНЕ® B6")).toBe("магне b6");
    expect(foldCatalogText("hopantenic-acid").startsWith("нор")).toBe(true);
  });

  it("folds only words that mix alphabets", () => {
    expect(foldMixedWords("мигрeнь с аурой")).toBe("мигрень с аурой");
    expect(foldMixedWords("гепатит b cholerae")).toBe("гепатит b cholerae");
  });
});

// ── The catalog route, on the production cases ───────────────────────────

describe("drug catalog search, word by word (production 30.09.2026)", () => {
  it("«аспирин» still finds its three rows", async () => {
    const body = await search("аспирин");
    expect(ids(body)).toEqual(["aspirin", ASPIRIN_C, "uzr-aspirin-kardio"].sort());
  });

  it.each(["аспирин с", "аспирин c", "АСПИРИН® С", "Аспирин С 1 таб"])(
    "«%s» leads with АСПИРИН® С (acetylsalicylic + ascorbic acid)",
    async (q) => {
      const body = await search(q);
      expect(body.total).toBeGreaterThan(0);
      expect(body.rows[0]?.id).toBe(ASPIRIN_C);
      expect(body.rows[0]?.nameRu).toBe("ацетилсалициловая кислота + аскорбиновая кислота");
    },
  );

  it("«токката» finds both rows, «токката рапид» the one with lidocaine", async () => {
    expect(ids(await search("токката"))).toEqual(["uzr-lidokain-tolperizon", "uzr-tolperizon"]);
    for (const q of ["токката рапид", "Токката® рапид", "токката рап"]) {
      const body = await search(q);
      expect(body.rows[0]?.id).toBe(TOKKATA_RAPID);
    }
  });

  it("«магне в6» with a Cyrillic В finds what «магне b6» finds", async () => {
    const latin = await search("магне b6");
    const cyrillic = await search("магне в6");
    expect(ids(latin)).toContain("uzr-magne-b6");
    expect(ids(latin)).toContain("magnesium_b6");
    expect(ids(latin)).toContain("uzr-magne-b6-forte");
    expect(ids(cyrillic)).toEqual(ids(latin));
    expect(cyrillic.rows.map((r) => r.id)).toEqual(latin.rows.map((r) => r.id));
    // The exact Магне B6 first, the forte after it.
    expect(cyrillic.rows[0]?.id).toBe("uzr-magne-b6");
    const order = cyrillic.rows.map((r) => r.id);
    expect(order.indexOf("uzr-magne-b6-forte")).toBeGreaterThan(order.indexOf("magnesium_b6"));
  });

  it("every word must be found: a second word narrows, it never widens", async () => {
    const one = await search("кислота");
    const two = await search("кислота аскорбиновая");
    expect(two.total).toBeGreaterThan(0);
    expect(two.total).toBeLessThan(one.total);
    for (const r of two.rows) {
      const text = [r.nameRu, r.inn, r.id, ...r.brands.map((b) => b.name)].join(" ").toLowerCase();
      expect(text).toContain("аскорбинов");
    }
  });

  it("a query of marks alone lists the catalog as an empty one does", async () => {
    const marks = await search("®");
    expect(marks.total).toBe(db.rows.length);
  });

  it("the clinic's core list is searched the same way", async () => {
    db.formulary = [
      {
        drugId: "magnesium_b6",
        label: "Магне B6",
        aliases: ["Магнелис"],
        strengths: [],
        sortOrder: 0,
        searchText: formularySearchText("Магне B6", ["Магнелис"]),
      },
    ];
    expect((await searchFormulary("магне в6", 20)).map((f) => f.drugId)).toEqual([
      "magnesium_b6",
    ]);
    expect(await searchFormulary("магне в12", 20)).toEqual([]);
    // Found through the clinic's name, it leads the search.
    expect((await search("магне в6")).rows[0]?.id).toBe("magnesium_b6");
  });
});

// ── Short Cyrillic prefixes against Latin slugs and INNs (review) ────────

describe("a Cyrillic prefix is not read as a Latin slug", () => {
  beforeEach(() => {
    db.rows = [...REGISTRY, ...CURATED_SEED];
  });

  const folded = (r: Row) => [r.nameRu, ...r.brands.map((b) => b.name)].map(foldCatalogText);

  it.each([
    ["нор", "hopantenic-acid"],
    ["тор", "topiramate"],
    ["вер", "bepanten"],
    ["ас", "actovegin"],
  ])("«%s» does not find %s at all", async (q, id) => {
    const body = await search(q, 100);
    expect(body.rows.map((r) => r.id)).not.toContain(id);
    // The first row is named with the prefix, as typed.
    expect(folded(body.rows[0]!).some((v) => v.startsWith(q))).toBe(true);
  });

  it("«тор» puts Торасемид first among the curated rows, «вер» Верапамил", async () => {
    const tor = (await search("тор", 100)).rows.map((r) => r.id);
    expect(tor).toContain("torasemide");
    const ver = (await search("вер", 100)).rows.map((r) => r.id);
    expect(ver).toContain("verapamil");
  });

  it("«ра» leads with names that start with «ра», not Парацетамол (paracetamol)", async () => {
    const body = await search("ра", 12);
    for (const r of body.rows) {
      expect(folded(r).some((v) => v.startsWith("ра"))).toBe(true);
    }
    expect(body.rows.map((r) => r.id)).not.toContain("paracetamol");
  });

  it("«тор» finds only rows whose names hold «тор»", async () => {
    // Before, it also matched every row whose id or INN holds a Latin
    // «top» («topiramate», «uzr-ketoprofen», «uzr-metoprolol»), which reads
    // «топ».
    const body = await search("тор", 100);
    for (const r of body.rows) {
      const text = [r.nameRu, r.nameUz ?? "", ...r.brands.map((b) => b.name)]
        .join(" ")
        .toLowerCase();
      expect(text).toContain("тор");
    }
  });

  it("the production cases still hold on the whole curated seed", async () => {
    expect((await search("аспирин с")).rows[0]?.id).toBe(ASPIRIN_C);
    expect((await search("токката рапид")).rows[0]?.id).toBe(TOKKATA_RAPID);
    const magne = (await search("магне в6")).rows.map((r) => r.id);
    expect(magne).toContain("uzr-magne-b6");
    expect(magne).toContain("magnesium_b6");
  });
});

describe("rank compares ids and INNs letter for letter", () => {
  it("scores a Latin slug as nothing for a Cyrillic prefix", () => {
    const hop = { id: "hopantenic-acid", inn: "Hopantenic acid", nameRu: "Гопантеновая кислота", brands: [{ name: "Пантогам" }] };
    expect(rankDrugMatch(hop, "нор")).toBe(0);
    expect(rankDrugMatch({ id: "topiramate", inn: "Topiramate", nameRu: "Топирамат", brands: [] }, "тор")).toBe(0);
    expect(rankDrugMatch({ id: "torasemide", inn: "Torasemide", nameRu: "Торасемид", brands: [] }, "тор")).toBe(50);
    // Typed in Latin, the INN still ranks.
    expect(rankDrugMatch(hop, "hopantenic")).toBe(50);
    expect(rankDrugMatch(hop, "hopantenic acid")).toBe(100);
  });
});

// ── Ranking and the label the prescription carries ───────────────────────

describe("rank and label use the same fold", () => {
  const aspirinC = {
    id: ASPIRIN_C,
    inn: "uzr:x",
    nameRu: "ацетилсалициловая кислота + аскорбиновая кислота",
    brands: [{ name: "АСПИРИН® С" }],
  };

  it("scores «аспирин c» as the brand exactly", () => {
    expect(rankDrugMatch(aspirinC, "аспирин c")).toBe(90);
    expect(rankDrugMatch(aspirinC, "аспирин с")).toBe(90);
    expect(rankDrugMatch({ ...aspirinC, brands: [{ name: "МАГНЕ® B6" }] }, "магне в6")).toBe(90);
    // «+» is a word break on both sides.
    expect(rankDrugMatch({ id: "x", inn: "x", nameRu: "Парацетамол + кофеин", brands: [] }, "парацетамол кофеин")).toBe(100);
  });

  it("prescribes the brand the doctor typed, whichever alphabet", () => {
    expect(matchedBrand(aspirinC, "аспирин c")).toBe("АСПИРИН® С");
    expect(prescriptionLabel(aspirinC, "аспирин c")).toBe(
      "АСПИРИН® С (ацетилсалициловая кислота + аскорбиновая кислота)",
    );
    expect(
      matchedBrand({ nameRu: "лидокаин + толперизон", brands: [{ name: "Токката® рапид" }] }, "токката рапид"),
    ).toBe("Токката® рапид");
  });

  it("groups one free-typed drug however its letters were typed", () => {
    const at = new Date("2026-09-30T08:00:00Z");
    const rows = buildDrugShortlist({
      pinnedIds: [],
      structured: [],
      freeText: [
        { line: "Магне B6", at },
        { line: "Магне® В6", at },
      ],
      limit: 12,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(2);
  });
});

// ── The CDS text matcher ──────────────────────────────────────────────────

describe("CDS text lines", () => {
  const index = buildDrugTextIndex([...REGISTRY, ...CURATED]);
  const resolve = (line: string) => matchDrugLine(index, line)?.drug.id ?? null;

  it("«Аспирин C» with a Latin C is АСПИРИН® С, not plain aspirin", () => {
    expect(drugNameKey("Аспирин C")).toBe(drugNameKey("АСПИРИН® С"));
    expect(resolve("Аспирин C 1 таб растворить")).toBe(ASPIRIN_C);
    expect(resolve("Аспирин С 1 таб растворить")).toBe(ASPIRIN_C);
  });

  it("«Магне В6» and «Токката рапид» resolve", () => {
    expect(resolve("Магне В6 по 2 таб")).toBe(resolve("Магне B6 по 2 таб"));
    expect(resolve("Магне В6 по 2 таб")).not.toBeNull();
    expect(resolve("Токката рапид 1 таб")).toBe(TOKKATA_RAPID);
  });

  it("the print's line lookup still finds Latin and lookalike spellings", async () => {
    expect(
      await resolveLineDrugIds(["Paracetamol 500 mg", "Аспирин C 1 таб", "Токката рапид"]),
    ).toEqual(["paracetamol", ASPIRIN_C, TOKKATA_RAPID]);
  });
});

// ── ICD: codes typed with Cyrillic letters ────────────────────────────────

describe("ICD search, lookalike slips only", () => {
  it("reads «М54.5» with a Cyrillic М as M54.5", () => {
    expect(searchIcd10("М54.5", 5)[0]?.code).toBe("M54.5");
    expect(searchIcd10("Е11", 5)[0]?.code).toBe(searchIcd10("E11", 5)[0]?.code);
  });

  it("finds «мигрeнь» (Latin e) as «мигрень»", () => {
    expect(searchIcd10("мигрeнь", 8).map((e) => e.code)).toEqual(
      searchIcd10("мигрень", 8).map((e) => e.code),
    );
  });

  it("leaves every one-alphabet query as it was", () => {
    expect(icdQueryTerms("мигрень с аурой")).toEqual({
      text: "мигрень с аурой",
      code: "мигрень с аурой",
    });
    expect(icdQueryTerms("гепатит b")).toEqual({ text: "гепатит b", code: "гепатит b" });
    // A lone letter stays a word, not a whole chapter.
    expect(icdQueryTerms("м")).toEqual({ text: "м", code: "м" });
  });
});
