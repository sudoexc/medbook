/**
 * Import the state medicines register (Госреестр ЛС, УзФармНадзор) into the
 * drug catalog. Source payload: prisma/uzpharm-registry.json, generated from
 * the official N30 (10.09.2026) xlsx — 8028 registrations normalised into
 * ~2.7k entities (grouped by МНН; trade-name entities for the «Отсутствует
 * утверждённое МНН» rows).
 *
 * Contract:
 *   - ADD-ONLY. The curated catalog (hand-written dosing, indications,
 *     interactions) is never updated, only enriched with missing brand rows.
 *   - Idempotent: matching is by id / inn / normalised name+brand, so a
 *     re-run is a no-op.
 *   - DRY RUN by default; APPLY=1 writes.
 *
 * Run (prod):
 *   docker compose run --rm -e APPLY=1 worker npx tsx scripts/import-uzpharm-registry.ts
 * Local:
 *   npx tsx scripts/import-uzpharm-registry.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type DrugCategory } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type RegistryEntity = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  category: DrugCategory;
  rxOnly: boolean;
  isTradeEntity: boolean;
  forms: { form: string; strengths: string[] }[];
  brands: { name: string; manufacturer: string | null; country: string | null }[];
};

const APPLY = process.env.APPLY === "1";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

async function main() {
  const payload = JSON.parse(
    readFileSync(join(process.cwd(), "prisma", "uzpharm-registry.json"), "utf8"),
  ) as { source: string; entities: RegistryEntity[] };

  const existingDrugs = await prisma.drug.findMany({
    select: { id: true, inn: true, nameRu: true },
  });
  const existingBrands = await prisma.drugBrand.findMany({
    select: { drugId: true, name: true },
  });

  // Any known handle → drugId. Brand names participate so «Мидокалм» in the
  // registry lands on the curated tolperisone row instead of a duplicate.
  const handleToDrug = new Map<string, string>();
  for (const d of existingDrugs) {
    handleToDrug.set(norm(d.nameRu), d.id);
    handleToDrug.set(norm(d.inn), d.id);
    handleToDrug.set(d.id, d.id);
  }
  for (const b of existingBrands) {
    if (!handleToDrug.has(norm(b.name))) handleToDrug.set(norm(b.name), b.drugId);
  }
  const brandSetByDrug = new Map<string, Set<string>>();
  for (const b of existingBrands) {
    (brandSetByDrug.get(b.drugId) ?? brandSetByDrug.set(b.drugId, new Set()).get(b.drugId)!).add(
      norm(b.name),
    );
  }

  let createdDrugs = 0;
  let enrichedBrands = 0;
  let skippedExisting = 0;

  const newDrugs: RegistryEntity[] = [];
  const brandRows: { drugId: string; name: string; manufacturer: string | null }[] = [];

  for (const e of payload.entities) {
    // Find a home: the entity's own name, or any of its brand names.
    let drugId =
      handleToDrug.get(norm(e.nameRu)) ??
      handleToDrug.get(e.id) ??
      null;
    if (!drugId) {
      for (const b of e.brands) {
        const hit = handleToDrug.get(norm(b.name));
        if (hit) {
          drugId = hit;
          break;
        }
      }
    }

    if (drugId) {
      skippedExisting += 1;
      const set =
        brandSetByDrug.get(drugId) ??
        brandSetByDrug.set(drugId, new Set()).get(drugId)!;
      for (const b of e.brands) {
        const bn = norm(b.name);
        // A brand equal to the drug's own name adds nothing to search.
        if (set.has(bn) || bn === norm(e.nameRu)) continue;
        set.add(bn);
        handleToDrug.set(bn, drugId);
        brandRows.push({ drugId, name: b.name, manufacturer: b.manufacturer });
        enrichedBrands += 1;
      }
      continue;
    }

    // New entity. Register its handles first so later registry entities
    // sharing a brand fold into it instead of duplicating.
    createdDrugs += 1;
    newDrugs.push(e);
    handleToDrug.set(norm(e.nameRu), e.id);
    const set = new Set<string>([norm(e.nameRu)]);
    brandSetByDrug.set(e.id, set);
    for (const b of e.brands) {
      const bn = norm(b.name);
      if (set.has(bn)) continue;
      set.add(bn);
      handleToDrug.set(bn, e.id);
      brandRows.push({ drugId: e.id, name: b.name, manufacturer: b.manufacturer });
      enrichedBrands += 1;
    }
  }

  console.log(`[uzpharm] source: ${payload.source}`);
  console.log(`[uzpharm] entities: ${payload.entities.length}`);
  console.log(`[uzpharm] matched existing drugs (brand-enriched only): ${skippedExisting}`);
  console.log(`[uzpharm] new drugs to create: ${createdDrugs}`);
  console.log(`[uzpharm] new brand rows to create: ${enrichedBrands}`);

  if (!APPLY) {
    console.log("[uzpharm] DRY RUN — set APPLY=1 to write.");
    return;
  }

  // Insert in chunks; createMany + skipDuplicates makes re-runs cheap.
  const CHUNK = 500;
  for (let i = 0; i < newDrugs.length; i += CHUNK) {
    await prisma.drug.createMany({
      data: newDrugs.slice(i, i + CHUNK).map((e) => ({
        id: e.id,
        inn: e.inn,
        nameRu: cap(e.nameRu),
        atcCode: e.atcCode,
        category: e.category,
        forms: e.forms,
        rxOnly: e.rxOnly,
      })),
      skipDuplicates: true,
    });
    console.log(`[uzpharm] drugs ${Math.min(i + CHUNK, newDrugs.length)}/${newDrugs.length}`);
  }
  for (let i = 0; i < brandRows.length; i += CHUNK) {
    await prisma.drugBrand.createMany({
      data: brandRows.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
    console.log(`[uzpharm] brands ${Math.min(i + CHUNK, brandRows.length)}/${brandRows.length}`);
  }

  const total = await prisma.drug.count();
  console.log(`[uzpharm] done. Drug rows now: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
