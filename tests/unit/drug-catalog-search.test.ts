import { beforeEach, describe, expect, it, vi } from "vitest";

import registry from "../../prisma/uzpharm-registry.json";
import { Prisma } from "@/generated/prisma/client";
import {
  orderStrongTier,
  rankDrugMatch,
  splitPageWindow,
} from "@/server/catalog/drug-rank";

/**
 * Audit CT-09 and the server half of CT-01, against the real state register
 * (2.7k rows) loaded into a small in-memory stand-in for Prisma.
 *
 * CT-09: the catalog route took the first `limit` matches alphabetically and
 * ranked only that page, so «парацетамол» (26 matches, the plain drug 18th
 * alphabetically) never showed «Парацетамол» in the twelve-row typeahead.
 *
 * CT-01: «Чем заменить» offered drugs the clinic had hidden, ignored its
 * renames, and its «curated rows first» comment was not what the query did.
 */

type Row = {
  id: string;
  inn: string;
  nameRu: string;
  nameUz: string | null;
  atcCode: string | null;
  category: string;
  forms: unknown;
  indications: string[];
  contraindications: string[];
  sideEffects: string[];
  pregnancyCat: string;
  defaultDosing: unknown;
  rxOnly: boolean;
  active: boolean;
  photoUrl: string | null;
  clinicId: string | null;
  brands: { id: string; name: string; manufacturer: string | null }[];
};

function drug(partial: Partial<Row> & Pick<Row, "id" | "nameRu">): Row {
  return {
    inn: partial.id,
    nameUz: null,
    atcCode: null,
    category: "OTHER",
    forms: [],
    indications: [],
    contraindications: [],
    sideEffects: [],
    pregnancyCat: "UNKNOWN",
    defaultDosing: null,
    rxOnly: true,
    active: true,
    photoUrl: null,
    clinicId: null,
    brands: [],
    ...partial,
  };
}

type RegistryEntity = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  category: string;
  rxOnly: boolean;
  forms: unknown;
  brands: { name: string; manufacturer: string | null }[];
};

const REGISTRY: Row[] = (registry as { entities: RegistryEntity[] }).entities.map(
  (e) =>
    drug({
      id: e.id,
      inn: e.inn,
      nameRu: e.nameRu,
      atcCode: e.atcCode,
      category: e.category,
      rxOnly: e.rxOnly,
      forms: e.forms,
      brands: e.brands.map((b, i) => ({
        id: `${e.id}:${i}`,
        name: b.name,
        manufacturer: b.manufacturer,
      })),
    }),
);

// The curated core: Latin INN, capitalised name, dosing copy.
const CURATED: Row[] = [
  drug({ id: "paracetamol", inn: "Paracetamol", nameRu: "Парацетамол", atcCode: "N02BE01", defaultDosing: { adult: "500 мг" } }),
  drug({ id: "ketorolac", inn: "Ketorolac", nameRu: "Кеторолак", atcCode: "M01AB15", defaultDosing: { adult: "10 мг" } }),
  drug({ id: "diclofenac", inn: "Diclofenac", nameRu: "Диклофенак", atcCode: "M01AB05", defaultDosing: { adult: "50 мг" } }),
  drug({ id: "aceclofenac", inn: "Aceclofenac", nameRu: "Ацеклофенак", atcCode: "M01AB16", defaultDosing: { adult: "100 мг" } }),
];

// ── A small Prisma stand-in: just the filters these routes use ────────────
type Where = Record<string, unknown>;

function fieldMatches(val: unknown, f: Record<string, unknown>): boolean {
  if (f.not === Prisma.AnyNull) return val !== null && val !== undefined;
  if (f.equals === Prisma.AnyNull) return val === null || val === undefined;
  const ci = f.mode === "insensitive";
  const norm = (x: unknown) => (ci ? String(x).toLowerCase() : String(x));
  if ("in" in f) return (f.in as unknown[]).includes(val);
  if ("notIn" in f) return !(f.notIn as unknown[]).includes(val);
  if ("contains" in f) return val != null && norm(val).includes(norm(f.contains));
  if ("startsWith" in f) {
    return val != null && norm(val).startsWith(norm(f.startsWith));
  }
  if ("not" in f) return val !== f.not;
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
  hidden: new Set<string>(),
  overrides: new Map<string, Record<string, unknown>>(),
  formularyHits: [] as { drugId: string; label: string; aliases: string[]; strengths: string[]; sortOrder: number }[],
}));

function findMany(args: {
  where?: Where;
  orderBy?: unknown;
  skip?: number;
  take?: number;
  select?: { brands?: { take?: number } };
}) {
  let out = db.rows.filter((r) => matches(r, args.where ?? {}));
  if (args.orderBy) {
    out = [...out].sort((a, b) =>
      String(a.nameRu).localeCompare(String(b.nameRu), "ru"),
    );
  }
  const skip = args.skip ?? 0;
  out = out.slice(skip, args.take !== undefined ? skip + args.take : undefined);
  const brandTake = args.select?.brands?.take;
  return out.map((r) =>
    brandTake
      ? { ...r, brands: (r.brands as unknown[]).slice(0, brandTake) }
      : r,
  );
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    drug: {
      findMany: vi.fn(async (args: Parameters<typeof findMany>[0]) => findMany(args)),
      findFirst: vi.fn(async (args: { where: Where }) => findMany(args)[0] ?? null),
      count: vi.fn(async (args: { where: Where }) => findMany(args).length),
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
  loadClinicOverlays: vi.fn(async () => ({
    hidden: db.hidden,
    overrides: db.overrides,
  })),
}));

vi.mock("@/server/catalog/formulary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/catalog/formulary")>()),
  loadFormulary: vi.fn(async () => db.formularyHits),
  searchFormulary: vi.fn(async () => db.formularyHits),
}));

import { GET as listDrugs } from "@/app/api/crm/catalogs/drugs/route";
import { GET as similarDrugs } from "@/app/api/crm/catalogs/drugs/[id]/similar/route";

type ListBody = { rows: Row[]; total: number };

async function search(params: Record<string, string>): Promise<ListBody> {
  const url = new URL("http://x/api/crm/catalogs/drugs");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await listDrugs(new Request(url));
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
}

beforeEach(() => {
  db.rows = [...REGISTRY, ...CURATED];
  db.hidden = new Set();
  db.overrides = new Map();
  db.formularyHits = [];
});

describe("drug search ranks before it pages (CT-09)", () => {
  it.each(["парацетамол", "лидокаин", "цитиколин", "дексаметазон"])(
    "«%s» comes back as the first row of a twelve-row typeahead",
    async (q) => {
      const body = await search({ q, limit: "12" });
      expect(body.rows[0]?.nameRu.toLowerCase()).toBe(q);
    },
  );

  it("still finds it when the matches far outnumber the page", async () => {
    const body = await search({ q: "парацетамол", limit: "12" });
    expect(body.total).toBeGreaterThan(12);
    expect(body.rows).toHaveLength(12);
    // The mono drug first, then drugs that START with it, and only then the
    // combinations that merely contain it.
    const names = body.rows.map((r) => r.nameRu.toLowerCase());
    const firstInside = names.findIndex((n) => !n.startsWith("парацетамол"));
    const lastPrefix = names.findLastIndex((n) => n.startsWith("парацетамол"));
    if (firstInside >= 0) expect(firstInside).toBeGreaterThan(lastPrefix);
  });

  it.each(["парацетамол", "кислота"])(
    "pages «%s» through one fixed order: no drug skipped, none repeated",
    async (q) => {
      const whole = await search({ q, limit: "200" });
      expect(whole.total).toBeGreaterThan(20);
      const paged: string[] = [];
      for (let offset = 0; offset < whole.total; offset += 7) {
        const page = await search({ q, limit: "7", offset: String(offset) });
        paged.push(...page.rows.map((r) => r.id));
      }
      expect(paged).toEqual(whole.rows.map((r) => r.id));
      expect(new Set(paged).size).toBe(paged.length);
    },
  );

  it("serves the clinic's own names first, whatever the alphabet says", async () => {
    db.formularyHits = [
      { drugId: "uzr-paratsetamol-tramadol", label: "Залдиар", aliases: [], strengths: [], sortOrder: 0 },
    ];
    const body = await search({ q: "парацетамол", limit: "12" });
    expect(body.rows[0]?.id).toBe("uzr-paratsetamol-tramadol");
    expect(body.rows[0]?.brands[0]?.name).toBe("Залдиар");
  });

  it("drops hidden globals before paging, so the page is full and the total true", async () => {
    const before = await search({ q: "парацетамол", limit: "12" });
    db.hidden = new Set(before.rows.slice(0, 3).map((r) => r.id));
    const after = await search({ q: "парацетамол", limit: "12" });
    expect(after.rows).toHaveLength(12);
    expect(after.total).toBe(before.total - 3);
    for (const r of after.rows) expect(db.hidden.has(r.id)).toBe(false);
  });

  it("keeps the plain alphabetical page when nothing is typed", async () => {
    const body = await search({ limit: "5" });
    const names = body.rows.map((r) => r.nameRu);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "ru")));
  });
});

describe("drug-rank helpers", () => {
  const d = (id: string, nameRu: string, brands: string[] = []) => ({
    id,
    inn: id,
    nameRu,
    brands: brands.map((name) => ({ name })),
  });

  it("scores exact over brand over prefix over contains", () => {
    expect(rankDrugMatch(d("x", "Парацетамол"), "парацетамол")).toBe(100);
    expect(rankDrugMatch(d("x", "Ацетаминофен", ["Панадол"]), "панадол")).toBe(90);
    expect(rankDrugMatch(d("x", "парацетамол + кофеин"), "парацетамол")).toBe(50);
    expect(rankDrugMatch(d("x", "Ибупрофен", ["Нурофен"]), "нуро")).toBe(40);
    expect(rankDrugMatch(d("x", "кислота + парацетамол"), "парацетамол")).toBe(0);
    // ё and case never cost a match.
    expect(rankDrugMatch(d("x", "Ёд"), "ед")).toBe(100);
  });

  it("orders the strong tier stably, the clinic's names first", () => {
    const rows = [
      d("a", "парацетамол + кофеин"),
      d("b", "Парацетамол"),
      d("c", "парацетамол + фенилэфрин"),
      d("z", "Залдиар"),
    ];
    expect(orderStrongTier(rows, "парацетамол", ["z"]).map((r) => r.id)).toEqual([
      "z",
      "b",
      "a",
      "c",
    ]);
  });

  it("splits a page window across the two tiers", () => {
    expect(splitPageWindow(5, 0, 12)).toEqual({
      strongStart: 0,
      strongEnd: 5,
      restSkip: 0,
      restTake: 7,
    });
    expect(splitPageWindow(5, 12, 12)).toEqual({
      strongStart: 5,
      strongEnd: 5,
      restSkip: 7,
      restTake: 12,
    });
    expect(splitPageWindow(30, 12, 12)).toEqual({
      strongStart: 12,
      strongEnd: 24,
      restSkip: 0,
      restTake: 0,
    });
  });
});

describe("«Чем заменить» respects the clinic's catalog (CT-01)", () => {
  type SimilarBody = {
    alternatives: { id: string; nameRu: string }[];
  };
  async function similar(id: string): Promise<SimilarBody> {
    const res = await similarDrugs(
      new Request(`http://x/api/crm/catalogs/drugs/${id}/similar`),
    );
    expect(res.status).toBe(200);
    return (await res.json()) as SimilarBody;
  }

  it("never offers a drug the clinic hid", async () => {
    db.hidden = new Set(["diclofenac", "uzr-diklofenak"]);
    const ids = (await similar("ketorolac")).alternatives.map((a) => a.id);
    expect(ids).not.toContain("diclofenac");
    expect(ids).not.toContain("uzr-diklofenak");
    expect(ids).not.toContain("ketorolac");
    expect(ids.length).toBeGreaterThan(0);
  });

  it("shows the clinic's rename of an analogue", async () => {
    db.overrides = new Map([["uzr-atseklofenak", { nameRu: "Ацеклофенак (клиника)" }]]);
    const alt = (await similar("ketorolac")).alternatives.find(
      (a) => a.id === "uzr-atseklofenak",
    );
    expect(alt?.nameRu).toBe("Ацеклофенак (клиника)");
  });

  it("lists curated rows, which carry dosing text, before register rows", async () => {
    const ids = (await similar("ketorolac")).alternatives.map((a) => a.id);
    // «Диклофенак» and «Ацеклофенак» are curated; the register's
    // «ацеклофенак» sorts before «Диклофенак» but must come after both.
    expect(ids.slice(0, 2).sort()).toEqual(["aceclofenac", "diclofenac"]);
    expect(ids.indexOf("uzr-atseklofenak")).toBeGreaterThan(1);
  });
});
