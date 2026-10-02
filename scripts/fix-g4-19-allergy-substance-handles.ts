/**
 * Audit G4-19 data fix: allergies recorded under a drug's catalog handle.
 *
 * The CDS card's one-click «записать аллергию» buttons offered each
 * recognised drug's `inn` column, and for a register row that is a handle
 * («uzr:karbaleks»), for a curated row without a Latin INN its slug id
 * («aspirin_cardio», «iron_sorbifer»). A click wrote that handle into
 * PatientAllergy.substance: the patient card, the print and the reception
 * showed it as the allergy. The buttons now offer the Russian name; this
 * script rewrites the entries already written to the name of the drug the
 * handle belongs to. The allergy check reads the name as it read the handle
 * (it matches a drug's Russian name too).
 *
 * Only an entry that is exactly a handle is touched: anything a person
 * typed, a real Latin INN («Carbamazepine») among it, stays as written.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-g4-19-allergy-substance-handles.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-g4-19-allergy-substance-handles.ts
 *
 * Idempotent: a rewritten entry is a name, not a handle, and is not found
 * again.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { readableInn } from "../src/lib/catalogs/drug-names";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

async function main() {
  const drugs = await prisma.drug.findMany({
    select: { id: true, inn: true, nameRu: true },
  });
  // Handle (as the button wrote it, case folded) → the drug's Russian name.
  const nameOfHandle = new Map<string, string>();
  for (const d of drugs) {
    const inn = d.inn.trim();
    if (!inn || readableInn(d) !== null) continue;
    if (inn.toLowerCase() === d.nameRu.trim().toLowerCase()) continue;
    nameOfHandle.set(inn.toLowerCase(), d.nameRu.trim());
  }

  const allergies = await prisma.patientAllergy.findMany({
    select: { id: true, clinicId: true, substance: true },
  });
  const fixes = allergies.flatMap((a) => {
    const name = nameOfHandle.get(a.substance.trim().toLowerCase());
    return name ? [{ ...a, name }] : [];
  });

  console.log(`[g4-19] allergy entries: ${allergies.length}, written as a handle: ${fixes.length}`);
  for (const f of fixes) {
    console.log(`  ${f.id} (clinic ${f.clinicId}): «${f.substance}» → «${f.name}»`);
  }
  if (fixes.length === 0) {
    console.log("[g4-19] nothing to do");
  } else if (!APPLY) {
    console.log("[g4-19] DRY RUN: nothing written; run again with APPLY=1");
  } else {
    await prisma.$transaction(
      fixes.map((f) =>
        prisma.patientAllergy.updateMany({
          // Still the handle: an entry someone edited meanwhile stays theirs.
          where: { id: f.id, substance: f.substance },
          data: { substance: f.name },
        }),
      ),
    );
    console.log(`[g4-19] rewrote ${fixes.length} entr${fixes.length === 1 ? "y" : "ies"}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
