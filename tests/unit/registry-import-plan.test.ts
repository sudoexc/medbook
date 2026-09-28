/**
 * Audit CT-03 — the state register import glued different substances
 * together by a shared brand.
 *
 * ТОЛКИМАДО is registered both as «толперизон» and as «лидокаин +
 * толперизон», so the first import put the combination and all its brands
 * (МИОСПАН, МИОФЛЕКС…) on the tolperisone row and never created it: the
 * doctor saw «Миоспан (толперизон)», and a lidocaine allergy raised nothing.
 * These tests run the planner on the real register and the real curated
 * seed, and replay the first import to get the catalog production has now.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DRUGS } from "../../prisma/_drug-catalog";
import { DRUGS_EXTRA } from "../../prisma/_drug-catalog-extra";
import { DRUG_ENRICHMENT } from "../../prisma/_drug-data";
import {
  SAME_SUBSTANCE_HOMES,
  compositionKey,
  curatedBrandMap,
  curatedKeys,
  normName,
  planBrandRevision,
  planRegistryImport,
  type CatalogBrand,
  type CatalogDrug,
  type RegistryEntity,
} from "../../scripts/_registry-plan";
import { matchAllergy } from "@/server/cds/allergy-match";
import { buildDrugTextIndex, matchDrugLine } from "@/server/cds/drug-text-match";

const entities = (
  JSON.parse(
    readFileSync(join(process.cwd(), "prisma", "uzpharm-registry.json"), "utf8"),
  ) as { entities: RegistryEntity[] }
).entities;

const seed = [...DRUGS, ...DRUGS_EXTRA];
const curatedDrugs: CatalogDrug[] = seed.map((d) => ({
  id: d.id,
  inn: d.intl ?? d.id,
  nameRu: d.nameRu,
  clinicId: null,
  atcCode: DRUG_ENRICHMENT[d.id]?.atcCode ?? null,
}));
const curatedBrandRows: CatalogBrand[] = seed.flatMap((d) =>
  (d.brands ?? []).map((name) => ({ drugId: d.id, name })),
);
const curatedBrands = curatedBrandMap();
const byEntityId = new Map(entities.map((e) => [e.id, e]));
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** The first import, as it ran on production (kept to replay its damage). */
function legacyImport(drugs: CatalogDrug[], brands: CatalogBrand[]) {
  const norm = (s: string) => s.toLowerCase().replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
  const handle = new Map<string, string>();
  for (const d of drugs) {
    handle.set(norm(d.nameRu), d.id);
    handle.set(norm(d.inn), d.id);
    handle.set(d.id, d.id);
  }
  for (const b of brands) if (!handle.has(norm(b.name))) handle.set(norm(b.name), b.drugId);
  const sets = new Map<string, Set<string>>();
  for (const b of brands) {
    (sets.get(b.drugId) ?? sets.set(b.drugId, new Set()).get(b.drugId)!).add(norm(b.name));
  }
  const outDrugs = [...drugs];
  const outBrands = brands.map((b, i) => ({ ...b, id: `b${i}` }));
  for (const e of entities) {
    let id = handle.get(norm(e.nameRu)) ?? handle.get(e.id) ?? null;
    if (!id) {
      for (const b of e.brands) {
        const hit = handle.get(norm(b.name));
        if (hit) {
          id = hit;
          break;
        }
      }
    }
    if (!id) {
      id = e.id;
      outDrugs.push({ id, inn: e.inn, nameRu: cap(e.nameRu), clinicId: null, atcCode: e.atcCode });
      handle.set(norm(e.nameRu), id);
      sets.set(id, new Set([norm(e.nameRu)]));
    }
    const set = sets.get(id) ?? sets.set(id, new Set()).get(id)!;
    for (const b of e.brands) {
      const bn = norm(b.name);
      if (set.has(bn) || bn === norm(e.nameRu)) continue;
      set.add(bn);
      handle.set(bn, id);
      outBrands.push({ drugId: id, name: b.name, id: `b${outBrands.length}` });
    }
  }
  return { drugs: outDrugs, brands: outBrands };
}

/** Apply a plan to an in-memory catalog, as the fix script does. */
function apply(
  drugs: CatalogDrug[],
  brands: CatalogBrand[],
  plan: ReturnType<typeof planBrandRevision>,
) {
  const removed = new Set(plan.misplaced.map((m) => m.id));
  return {
    drugs: [
      ...drugs,
      ...plan.newDrugs.map((e) => ({
        id: e.id,
        inn: e.inn,
        nameRu: cap(e.nameRu),
        clinicId: null,
        atcCode: e.atcCode,
      })),
    ],
    brands: [
      ...brands.filter((b) => !removed.has(b.id)),
      ...plan.brandRows.map((b, i) => ({ drugId: b.drugId, name: b.name, id: `n${i}` })),
    ],
  };
}

const brandsOf = (brands: CatalogBrand[], drugId: string) =>
  brands.filter((b) => b.drugId === drugId).map((b) => normName(b.name));

describe("register import on a clean catalog (CT-03)", () => {
  const plan = planRegistryImport({
    entities,
    drugs: curatedDrugs,
    brands: curatedBrandRows,
    curatedBrands,
  });
  const homeOf = (id: string) => plan.homes.get(id)!;

  it("joins no entity to a row of another composition", () => {
    const rowName = new Map(curatedDrugs.map((d) => [d.id, d.nameRu]));
    for (const e of plan.newDrugs) rowName.set(e.id, e.nameRu);
    const glued: string[] = [];
    for (const e of entities) {
      if (e.isTradeEntity) continue; // the register states no composition
      const home = homeOf(e.id);
      if (home.via === "new" || home.via === "id" || home.via === "same-substance") continue;
      const row = rowName.get(home.drugId)!;
      const rowKeys = [compositionKey(row), ...curatedKeys(row)];
      if (!rowKeys.includes(compositionKey(e.nameRu))) glued.push(`${e.nameRu} → ${row}`);
    }
    expect(glued).toEqual([]);
  });

  it("gives «лидокаин + толперизон» its own row with Миоспан on it", () => {
    expect(homeOf("uzr-lidokain-tolperizon")).toEqual({
      drugId: "uzr-lidokain-tolperizon",
      via: "new",
    });
    const onCombo = plan.brandRows
      .filter((b) => b.drugId === "uzr-lidokain-tolperizon")
      .map((b) => normName(b.name));
    expect(onCombo).toEqual(expect.arrayContaining(["миоспан", "миофлекс", "толкимадо"]));
    const onTolperisone = plan.brandRows
      .filter((b) => b.drugId === "tolperisone")
      .map((b) => normName(b.name));
    expect(onTolperisone).not.toContain("миоспан");
    // A brand registered under both keeps both rows.
    expect(onTolperisone).toContain("толкимадо");
    expect(plan.conflicts.map((c) => c.brand)).toContain("толкимадо");
  });

  it("gives Гексикон to хлоргексидин, not to the lozenge combination", () => {
    expect(homeOf("uzr-khlorgeksidin").drugId).toBe("uzr-khlorgeksidin");
    const hexicon = plan.brandRows.filter((b) => normName(b.name) === "гексикон");
    expect(hexicon.map((b) => b.drugId)).toEqual(["uzr-khlorgeksidin"]);
  });

  it("keeps ФЕРОМАКС (iron) away from folic acid", () => {
    expect(homeOf("uzr-feromaks")).toEqual({ drugId: "uzr-feromaks", via: "new" });
  });

  it("still lands a substance on its curated row", () => {
    expect(homeOf("uzr-tolperizon").drugId).toBe("tolperisone");
    for (const [entity, curated] of Object.entries(SAME_SUBSTANCE_HOMES)) {
      if (byEntityId.has(entity)) expect(homeOf(entity).drugId).toBe(curated);
    }
    // A trade name the register lists as a brand of one substance.
    expect(homeOf("uzr-meksidol").drugId).toBe("mexidol");
  });

  it("never makes a clinic's own drug the home of a register entity", () => {
    const withClinicRow = planRegistryImport({
      entities,
      drugs: [
        ...curatedDrugs,
        { id: "clinic-1", inn: "clinic:c1:1", nameRu: "Лидокаин + толперизон", clinicId: "c1" },
      ],
      brands: [...curatedBrandRows, { drugId: "clinic-1", name: "Миоспан" }],
      curatedBrands,
    });
    expect(withClinicRow.homes.get("uzr-lidokain-tolperizon")!.drugId).toBe(
      "uzr-lidokain-tolperizon",
    );
    expect(withClinicRow.brandRows.some((b) => b.drugId === "clinic-1")).toBe(false);
  });

  it("lets the allergy check see lidocaine when Миоспан is prescribed", () => {
    const drugs = [
      ...curatedDrugs.map((d) => ({ ...d, brands: brandsOf(curatedBrandRows, d.id).map((name) => ({ name })) })),
      ...plan.newDrugs.map((e) => ({
        id: e.id,
        inn: e.inn,
        nameRu: cap(e.nameRu),
        atcCode: e.atcCode,
        clinicId: null,
        brands: [] as { name: string }[],
      })),
    ];
    const byId = new Map(drugs.map((d) => [d.id, d]));
    for (const b of plan.brandRows) byId.get(b.drugId)!.brands.push({ name: b.name });

    const hit = matchDrugLine(buildDrugTextIndex(drugs), "Миоспан 2 мл в/м");
    expect(hit?.drug.id).toBe("uzr-lidokain-tolperizon");
    const miospan = byId.get("uzr-lidokain-tolperizon")!;
    expect(
      matchAllergy("лидокаин", {
        id: miospan.id,
        inn: miospan.inn,
        nameRu: miospan.nameRu,
        atcCode: miospan.atcCode ?? null,
        brandNames: miospan.brands.map((b) => b.name),
      }),
    ).toEqual({ kind: "SUBSTANCE" });
  });
});

describe("fix for the catalog the first import left (CT-03)", () => {
  const legacy = legacyImport(curatedDrugs, curatedBrandRows);
  const plan = planBrandRevision({ ...legacy, entities, curatedBrands });

  it("finds the damage the audit describes", () => {
    expect(brandsOf(legacy.brands, "tolperisone")).toContain("миоспан");
    expect(legacy.drugs.some((d) => d.id === "uzr-lidokain-tolperizon")).toBe(false);
  });

  it("creates the missing rows and moves the brands onto them", () => {
    const created = plan.newDrugs.map((e) => e.id);
    expect(created).toEqual(
      expect.arrayContaining(["uzr-lidokain-tolperizon", "uzr-khlorgeksidin"]),
    );
    const removed = plan.misplaced.map((m) => `${m.drugId}:${normName(m.name)}`);
    expect(removed).toEqual(
      expect.arrayContaining([
        "tolperisone:миоспан",
        "tolperisone:миофлекс",
        "uzr-benzokain-khlorgeksidin-enoksolon:гексикон",
      ]),
    );
    // Curated brands and shared brands stay where they are.
    expect(removed).not.toContain("tolperisone:мидокалм");
    expect(removed).not.toContain("tolperisone:толкимадо");
  });

  it("touches only rows of another composition, never a curated brand", () => {
    for (const m of plan.misplaced) {
      expect(curatedBrands.get(m.drugId)?.map(normName) ?? []).not.toContain(normName(m.name));
    }
  });

  it("is idempotent, and the import after it adds nothing", () => {
    const fixed = apply(legacy.drugs, legacy.brands, plan);
    expect(brandsOf(fixed.brands, "uzr-lidokain-tolperizon")).toEqual(
      expect.arrayContaining(["миоспан", "толкимадо"]),
    );
    expect(brandsOf(fixed.brands, "tolperisone")).not.toContain("миоспан");
    expect(brandsOf(fixed.brands, "uzr-khlorgeksidin")).toContain("гексикон");

    const again = planBrandRevision({ ...fixed, entities, curatedBrands });
    expect([again.newDrugs.length, again.misplaced.length, again.brandRows.length]).toEqual([
      0, 0, 0,
    ]);
    const reimport = planRegistryImport({ ...fixed, entities, curatedBrands });
    expect([reimport.newDrugs.length, reimport.brandRows.length]).toEqual([0, 0]);
  });
});
