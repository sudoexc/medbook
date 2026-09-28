/**
 * Audit CT-03 data fix: register brands the first import put on a row of
 * another composition.
 *
 * The first `import-uzpharm-registry.ts` found a home for a register entity
 * through ANY of its brands. ТОЛКИМАДО is registered both as tolperisone and
 * as tolperisone + lidocaine, so «лидокаин + толперизон» was never created
 * and МИОСПАН, МИОФЛЕКС, СЕВИПРОКС and four more brands sit on the curated
 * «Толперизон» row: a doctor sees tolperisone alone, and a lidocaine allergy
 * raises no warning. Хлоргексидин's brands (Гексикон, Септум, Гексидин) sit
 * on the lozenge row «бензокаин + хлоргексидин + эноксолон», ascorbic acid's
 * on «Железа сульфат», and so on (see `_registry-plan.ts`).
 *
 * This fix, planned by `planBrandRevision` from the register and the live
 * catalog:
 *   1. creates the register rows that were never created (their forms, ATC
 *      code and composition come from the register entity);
 *   2. removes a brand row from a shared row when the register lists that
 *      brand only under other compositions and the curated seed does not
 *      list it for that row;
 *   3. adds the brand rows the register gives each row (the moved brands on
 *      their right row, among them).
 * A brand the register gives to several compositions (ТОЛКИМАДО) stays on
 * each. Clinic-owned rows, curated brands and brand rows the register does
 * not know are never touched. DrugBrand rows are pure catalog data: nothing
 * references them, so removing one loses nothing.
 *
 * Prescriptions already written keep their drug and their printed name
 * («Миоспан (толперизон)»): they are signed documents. The dry run counts
 * them so the doctor can be told; new prescriptions of the brand resolve to
 * the right row at once, from search and from his «мои частые» alike (the
 * drug shortlist re-pins a history use whose label names a moved brand, see
 * `repinDrugUses` in src/server/catalog/shortlist.ts).
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-ct03-registry-brand-homes.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-ct03-registry-brand-homes.ts
 *
 * Idempotent: a second run plans nothing. Run it before any re-run of the
 * import, which only adds.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type DrugCategory } from "../src/generated/prisma/client";
import {
  curatedBrandMap,
  normName,
  planBrandRevision,
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

  const plan = planBrandRevision({
    entities: payload.entities,
    drugs,
    brands,
    curatedBrands: curatedBrandMap(),
  });

  console.log(`[ct03] register: ${payload.source}`);
  console.log(`[ct03] rows to create: ${plan.newDrugs.length}`);
  for (const e of plan.newDrugs) {
    console.log(`  + ${cap(e.nameRu)} (${e.id}, ATC ${e.atcCode ?? "none"})`);
  }

  console.log(`[ct03] brand rows to remove from a row of another composition: ${plan.misplaced.length}`);
  for (const m of plan.misplaced) {
    console.log(`  - «${m.name}» from «${nameOf.get(m.drugId) ?? m.drugId}»: ${m.reason}`);
  }

  console.log(`[ct03] brand rows to add: ${plan.brandRows.length}`);
  const newIds = new Set(plan.newDrugs.map((e) => e.id));
  for (const b of plan.brandRows) {
    const on = newIds.has(b.drugId)
      ? cap(plan.newDrugs.find((e) => e.id === b.drugId)!.nameRu)
      : (nameOf.get(b.drugId) ?? b.drugId);
    console.log(`  + «${b.name}» on «${on}»`);
  }

  // Prescriptions written under a moved brand keep what the doctor signed.
  if (plan.misplaced.length > 0) {
    const written = await prisma.visitPrescription.findMany({
      where: { drugId: { in: [...new Set(plan.misplaced.map((m) => m.drugId))] } },
      select: { drugId: true, displayName: true },
    });
    const moved = plan.misplaced.map((m) => ({ drugId: m.drugId, key: normName(m.name) }));
    const hits = written.filter((p) =>
      moved.some(
        (m) => m.drugId === p.drugId && normName(p.displayName).startsWith(m.key),
      ),
    );
    console.log(
      `[ct03] prescriptions already written under a moved brand: ${hits.length} (left as signed)`,
    );
  }

  if (plan.newDrugs.length + plan.misplaced.length + plan.brandRows.length === 0) {
    console.log("[ct03] nothing to do");
    return;
  }
  if (!APPLY) {
    console.log("[ct03] DRY RUN: nothing written; run again with APPLY=1");
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
      await tx.drugBrand.createMany({ data: plan.brandRows });
    }
  });
  console.log(
    `[ct03] done: ${plan.newDrugs.length} row(s) created, ${plan.misplaced.length} brand row(s) removed, ${plan.brandRows.length} added`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
