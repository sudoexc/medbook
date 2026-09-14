/**
 * Lifts the birth year out of `Patient.fullName` into `Patient.birthDate`.
 *
 * The clinic's doctor entered his first ~100 patients as «Турматов О 1969» —
 * surname, initial, year, all in the name field. The year was therefore dead
 * data: `birthDate` was null for every patient, so nothing could show an age.
 * New patients are parsed on the way in (`src/lib/patients/parse-identity.ts`);
 * this backfills the ones already stored.
 *
 * Dry run by default — prints what it would change and touches nothing:
 *   docker compose exec -T worker npx tsx scripts/backfill-birth-year-from-name.ts
 *
 * Apply:
 *   docker compose exec -T worker npx tsx scripts/backfill-birth-year-from-name.ts --apply
 *
 * Safe to re-run: patients that already have a `birthDate` are skipped, so an
 * age entered by hand later is never overwritten.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  birthDateFromYear,
  parsePatientIdentity,
} from "../src/lib/patients/parse-identity";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

async function main() {
  const apply = process.argv.includes("--apply");

  const patients = await prisma.patient.findMany({
    where: { birthDate: null },
    select: { id: true, fullName: true, patientNumber: true },
    orderBy: { createdAt: "asc" },
  });

  const planned: {
    id: string;
    from: string;
    toName: string;
    year: number;
    age: number;
  }[] = [];

  for (const p of patients) {
    const parsed = parsePatientIdentity(p.fullName);
    if (!parsed.matched || parsed.birthYear === null) continue;
    planned.push({
      id: p.id,
      from: p.fullName,
      toName: parsed.fullName,
      year: parsed.birthYear,
      age: parsed.age!,
    });
  }

  console.log(
    `┌─ ${apply ? "APPLY" : "DRY RUN"}: ${patients.length} пациентов без даты рождения, ` +
      `год распознан у ${planned.length}`,
  );

  for (const row of planned) {
    console.log(
      `  «${row.from}» → «${row.toName}» + ${row.year} г.р. (${row.age} лет)`,
    );
  }

  const skipped = patients.length - planned.length;
  if (skipped > 0) {
    console.log(`  · без года в имени, пропущено: ${skipped}`);
  }

  if (!apply) {
    console.log("└─ ничего не изменено. Повторить с --apply\n");
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const row of planned) {
    await prisma.patient.update({
      where: { id: row.id },
      data: { fullName: row.toName, birthDate: birthDateFromYear(row.year) },
    });
    done++;
  }
  console.log(`└─ обновлено ${done} пациентов\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ backfill failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
