/**
 * Audit G4-12 data fix: phenazepam's ATC code.
 *
 * The seed filed phenazepam under N05BX («other anxiolytics», next to
 * afobazole) although it is a benzodiazepine, N05BA in the Russian register.
 * The duplicate check and the similar-drugs list group by that code, so it
 * paired феназепам with афобазол and missed феназепам + диазепам. The seed
 * (prisma/_drug-data.ts) is fixed; this script fixes the live row without a
 * reseed.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-g4-12-phenazepam-atc.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-g4-12-phenazepam-atc.ts
 *
 * Idempotent: only a row still carrying N05BX is touched.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

async function main() {
  const row = await prisma.drug.findUnique({
    where: { id: "phenazepam" },
    select: { id: true, nameRu: true, atcCode: true },
  });
  if (!row) {
    console.log("phenazepam: no such drug row, nothing to do");
  } else if (row.atcCode !== "N05BX") {
    console.log(`phenazepam: atcCode is ${row.atcCode ?? "null"}, nothing to do`);
  } else if (!APPLY) {
    console.log("DRY RUN: phenazepam N05BX → N05BA. Nothing written; run again with APPLY=1");
  } else {
    const res = await prisma.drug.updateMany({
      where: { id: "phenazepam", atcCode: "N05BX" },
      data: { atcCode: "N05BA" },
    });
    console.log(`phenazepam: updated ${res.count} row(s) to N05BA`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
