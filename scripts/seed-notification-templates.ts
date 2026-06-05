/**
 * Idempotent seeder for the 8 default notification templates introduced in
 * TZ-notifications-cancel-sync.md. Iterates every existing Clinic and
 * upserts each row from `DEFAULT_APPOINTMENT_TEMPLATES`. Safe to re-run —
 * existing rows are detected by `(clinicId, key)` and left untouched (so
 * an admin's manual edits survive a re-seed).
 *
 * Usage (one-off, after `prisma migrate deploy`):
 *
 *   docker compose run --rm worker npx tsx scripts/seed-notification-templates.ts
 *
 * Without docker: from the repo root, with `DATABASE_URL` in env:
 *
 *   npx tsx scripts/seed-notification-templates.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_APPOINTMENT_TEMPLATES } from "../src/server/notifications/default-templates";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

async function main() {
  const clinics = await prisma.clinic.findMany({
    select: { id: true, slug: true, nameRu: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Found ${clinics.length} clinic(s)`);

  let createdCount = 0;
  let skippedCount = 0;

  for (const clinic of clinics) {
    for (const t of DEFAULT_APPOINTMENT_TEMPLATES) {
      const existing = await prisma.notificationTemplate.findUnique({
        where: { clinicId_key: { clinicId: clinic.id, key: t.key } },
        select: { id: true },
      });

      if (existing) {
        skippedCount += 1;
        console.log(`  [skip] ${clinic.slug} :: ${t.key} (already exists)`);
        continue;
      }

      await prisma.notificationTemplate.create({
        data: {
          clinicId: clinic.id,
          key: t.key,
          nameRu: t.nameRu,
          nameUz: t.nameUz,
          channel: t.channel,
          category: t.category,
          trigger: t.trigger,
          triggerConfig: (t.triggerConfig ?? undefined) as never,
          bodyRu: t.bodyRu,
          bodyUz: t.bodyUz,
          variables: t.variables,
          isActive: true,
        },
      });
      createdCount += 1;
      console.log(`  [+]    ${clinic.slug} :: ${t.key}`);
    }
  }

  console.log(`\nDone. Created: ${createdCount}, skipped: ${skippedCount}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
