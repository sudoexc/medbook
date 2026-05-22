/**
 * Seeds HandoutTemplate rows from `_handout-data.ts`.
 *
 * Idempotent: upserts by `code`. Templates that disappeared from the seed
 * (renamed/removed) get deactivated (active=false) so existing references
 * don't 404 — clinic overrides will follow the same pattern in G6.
 *
 * Local: `npx tsx prisma/seed-handouts.ts`
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { HANDOUTS } from "./_handout-data";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const codes = HANDOUTS.map((h) => h.code);

  let upserts = 0;
  for (const h of HANDOUTS) {
    await prisma.handoutTemplate.upsert({
      where: { code: h.code },
      update: {
        titleRu: h.titleRu,
        titleUz: h.titleUz ?? null,
        summaryRu: h.summaryRu ?? null,
        bodyMd: h.bodyMd,
        matchPrefixes: h.matchPrefixes ?? [],
        topic: h.topic ?? null,
        sortOrder: h.sortOrder ?? 0,
        active: true,
      },
      create: {
        code: h.code,
        titleRu: h.titleRu,
        titleUz: h.titleUz ?? null,
        summaryRu: h.summaryRu ?? null,
        bodyMd: h.bodyMd,
        matchPrefixes: h.matchPrefixes ?? [],
        topic: h.topic ?? null,
        sortOrder: h.sortOrder ?? 0,
      },
    });
    upserts += 1;
  }

  const deactivated = await prisma.handoutTemplate.updateMany({
    where: { code: { notIn: codes }, active: true },
    data: { active: false },
  });

  console.log(`Upserted ${upserts} handouts. Deactivated ${deactivated.count} stale rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
