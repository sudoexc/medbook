/**
 * Seeds LabTest + LabPanel + LabPanelTest from `_lab-data.ts`.
 *
 * Idempotent: deletes existing tests/panels matching the seeded codes, then
 * re-inserts. Join rows live under `LabPanelTest` and are rebuilt from the
 * panel's `testCodes` list.
 *
 * Local: `npx tsx prisma/seed-labs.ts`
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { LAB_PANELS, LAB_TESTS } from "./_lab-data";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const testCodes = LAB_TESTS.map((t) => t.code);
  const panelCodes = LAB_PANELS.map((p) => p.code);

  await prisma.labPanelTest.deleteMany({
    where: {
      OR: [
        { test: { code: { in: testCodes } } },
        { panel: { code: { in: panelCodes } } },
      ],
    },
  });
  await prisma.labPanel.deleteMany({ where: { code: { in: panelCodes } } });
  await prisma.labTest.deleteMany({ where: { code: { in: testCodes } } });

  let testCount = 0;
  for (const t of LAB_TESTS) {
    await prisma.labTest.create({
      data: {
        id: t.id,
        code: t.code,
        nameRu: t.nameRu,
        nameUz: t.nameUz ?? null,
        loinc: t.loinc ?? null,
        biomaterial: t.biomaterial,
        unit: t.unit ?? null,
        refRanges:
          t.refRanges && t.refRanges.length > 0
            ? (t.refRanges as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        turnaroundHours: t.turnaroundHours ?? 24,
        priceUzs: t.priceUzs ?? null,
        commonForCodes: t.commonForCodes ?? [],
        patientPrep: t.patientPrep ?? null,
        sortOrder: t.sortOrder ?? 0,
        active: true,
      },
    });
    testCount += 1;
  }

  const testIdByCode = new Map<string, string>();
  const allTests = await prisma.labTest.findMany({
    where: { code: { in: testCodes } },
    select: { id: true, code: true },
  });
  for (const row of allTests) testIdByCode.set(row.code, row.id);

  let panelCount = 0;
  let joinCount = 0;
  for (const p of LAB_PANELS) {
    await prisma.labPanel.create({
      data: {
        id: p.id,
        code: p.code,
        nameRu: p.nameRu,
        nameUz: p.nameUz ?? null,
        description: p.description ?? null,
        sortOrder: p.sortOrder ?? 0,
        active: true,
      },
    });
    panelCount += 1;

    for (let i = 0; i < p.testCodes.length; i += 1) {
      const code = p.testCodes[i];
      const testId = testIdByCode.get(code);
      if (!testId) {
        console.warn(`  ⚠ panel ${p.code} references missing test ${code}`);
        continue;
      }
      await prisma.labPanelTest.create({
        data: { panelId: p.id, testId, sortOrder: i },
      });
      joinCount += 1;
    }
  }

  console.log(
    `Seeded ${testCount} lab tests, ${panelCount} panels, ${joinCount} panel→test joins.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
