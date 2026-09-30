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
 *   - An entity joins an existing row only through its substance, never
 *     through a shared brand (audit CT-03, see `_registry-plan.ts`): a brand
 *     registered both as «толперизон» and «лидокаин + толперизон» used to
 *     drag the combination's brands onto the tolperisone row. Clinic-owned
 *     rows are never a home.
 *   - Idempotent: matching is by id / name / composition, so a re-run is a
 *     no-op.
 *   - DRY RUN by default; APPLY=1 writes. The dry run lists every brand the
 *     register gives to entities of different composition.
 *
 * Brands an earlier run put on the wrong row are moved by
 * `fix-ct03-registry-brand-homes.ts`; this import only adds. A brand the
 * payload filed under one of its substances alone (АСПИРИН® С under
 * ascorbic acid) goes to its registered composition, see
 * `REGISTER_COMPOSITION_FIXES` and `fix-p4-register-compositions.ts`.
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

import {
  correctRegisterEntities,
  curatedBrandMap,
  planRegistryImport,
  type RegistryEntity,
} from "./_registry-plan";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.env.APPLY === "1";

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

async function main() {
  const payload = JSON.parse(
    readFileSync(join(process.cwd(), "prisma", "uzpharm-registry.json"), "utf8"),
  ) as { source: string; entities: RegistryEntity[] };
  const entities = correctRegisterEntities(payload.entities);

  const [drugs, brands] = await Promise.all([
    prisma.drug.findMany({
      select: { id: true, inn: true, nameRu: true, clinicId: true, atcCode: true },
    }),
    prisma.drugBrand.findMany({ select: { drugId: true, name: true } }),
  ]);

  const plan = planRegistryImport({
    entities,
    drugs,
    brands,
    curatedBrands: curatedBrandMap(),
  });
  const { newDrugs, brandRows } = plan;
  const byVia = new Map<string, number>();
  for (const h of plan.homes.values()) byVia.set(h.via, (byVia.get(h.via) ?? 0) + 1);

  console.log(`[uzpharm] source: ${payload.source}`);
  console.log(`[uzpharm] entities: ${entities.length}`);
  console.log(
    `[uzpharm] matched existing drugs (brand-enriched only): ${entities.length - newDrugs.length}`,
  );
  console.log(
    `[uzpharm] how entities found their row: ${[...byVia]
      .map(([via, n]) => `${via} ${n}`)
      .join(", ")}`,
  );
  console.log(`[uzpharm] new drugs to create: ${newDrugs.length}`);
  console.log(`[uzpharm] new brand rows to create: ${brandRows.length}`);
  console.log(
    `[uzpharm] brands the register lists under different compositions: ${plan.conflicts.length}` +
      " (kept on each row, the doctor picks the product)",
  );
  for (const c of plan.conflicts) {
    console.log(`  ${c.brand}: ${c.entities.map((e) => e.nameRu).join(" | ")}`);
  }

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
        category: e.category as DrugCategory,
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
