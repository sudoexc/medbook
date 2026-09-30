/**
 * Data fix: register brands filed under one of their substances alone
 * (`REGISTER_COMPOSITION_FIXES` in `_registry-plan.ts`).
 *
 * АСПИРИН® С is registered as acetylsalicylic acid + ascorbic acid, but the
 * normalised register payload grouped it under «аскорбиновая кислота», so
 * the import put the brand on the vitamin C row. Prescribed as «Аспирин С»,
 * the drug resolved to vitamin C: a patient's aspirin allergy raised nothing,
 * and neither did the NSAID rules (aspirin + ketorolac, two NSAIDs).
 *
 * This fix, planned by `planCompositionFixes` (the part of
 * `planBrandRevision` about the brands the corrections name) from the
 * corrected register and the live catalog:
 *   1. creates the row of the registered composition when it is missing
 *      («Ацетилсалициловая кислота + аскорбиновая кислота», ATC N02BA51),
 *      whose two substances the CDS engine resolves to the curated rows;
 *   2. removes the brand row from the row of the other composition;
 *   3. adds the brand row on the new row.
 * Nothing else the plan might find is touched: that is the CT-03 fix's job
 * (fix-ct03-registry-brand-homes.ts).
 *
 * Prescriptions already written keep their drug and their printed name:
 * they are signed documents. The dry run counts them; new prescriptions of
 * the brand, from search and from the doctor's «мои частые» alike, resolve
 * to the right row at once (see `repinDrugUses`).
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-p4-register-compositions.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-p4-register-compositions.ts
 *
 * Idempotent: a second run plans nothing.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type DrugCategory } from "../src/generated/prisma/client";
import {
  curatedBrandMap,
  normName,
  planCompositionFixes,
  type RegistryEntity,
} from "./_registry-plan";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

async function main() {
  const payload = JSON.parse(
    readFileSync(join(process.cwd(), "prisma", "uzpharm-registry.json"), "utf8"),
  ) as { source: string; entities: RegistryEntity[] };

  const [drugs, brands] = await Promise.all([
    prisma.drug.findMany({
      select: { id: true, inn: true, nameRu: true, clinicId: true, atcCode: true },
    }),
    prisma.drugBrand.findMany({ select: { id: true, drugId: true, name: true } }),
  ]);
  const nameOf = new Map(drugs.map((d) => [d.id, d.nameRu]));

  const plan = planCompositionFixes({
    entities: payload.entities,
    drugs,
    brands,
    curatedBrands: curatedBrandMap(),
  });

  console.log(`[compositions] register: ${payload.source}`);
  console.log(`[compositions] rows to create: ${plan.newDrugs.length}`);
  for (const e of plan.newDrugs) {
    console.log(`  + ${cap(e.nameRu)} (${e.id}, ATC ${e.atcCode ?? "none"})`);
  }
  console.log(`[compositions] brand rows to remove: ${plan.misplaced.length}`);
  for (const m of plan.misplaced) {
    console.log(`  - «${m.name}» from «${nameOf.get(m.drugId) ?? m.drugId}»: ${m.reason}`);
  }
  console.log(`[compositions] brand rows to add: ${plan.brandRows.length}`);
  for (const b of plan.brandRows) {
    const on =
      plan.newDrugs.find((e) => e.id === b.drugId)?.nameRu ?? nameOf.get(b.drugId) ?? b.drugId;
    console.log(`  + «${b.name}» on «${cap(on)}»`);
  }

  // Prescriptions written under a moved brand keep what the doctor signed.
  if (plan.misplaced.length > 0) {
    const written = await prisma.visitPrescription.findMany({
      where: { drugId: { in: [...new Set(plan.misplaced.map((m) => m.drugId))] } },
      select: { drugId: true, displayName: true },
    });
    const moved = plan.misplaced.map((m) => ({ drugId: m.drugId, key: normName(m.name) }));
    const hits = written.filter((p) =>
      moved.some((m) => m.drugId === p.drugId && normName(p.displayName).startsWith(m.key)),
    );
    console.log(
      `[compositions] prescriptions already written under a moved brand: ${hits.length} (left as signed)`,
    );
  }

  if (plan.newDrugs.length + plan.misplaced.length + plan.brandRows.length === 0) {
    console.log("[compositions] nothing to do");
    return;
  }
  if (!APPLY) {
    console.log("[compositions] DRY RUN: nothing written; run again with APPLY=1");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (plan.newDrugs.length > 0) {
      await tx.drug.createMany({
        data: plan.newDrugs.map((e) => ({
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
    }
    if (plan.misplaced.length > 0) {
      await tx.drugBrand.deleteMany({
        where: { id: { in: plan.misplaced.map((m) => m.id!) } },
      });
    }
    if (plan.brandRows.length > 0) {
      await tx.drugBrand.createMany({ data: plan.brandRows, skipDuplicates: true });
    }
  });
  console.log(
    `[compositions] done: ${plan.newDrugs.length} row(s) created, ${plan.misplaced.length} brand row(s) removed, ${plan.brandRows.length} added`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
