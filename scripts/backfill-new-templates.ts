/**
 * Adds notification template keys introduced after a clinic was seeded:
 * today only `case.repeat-due` (the free repeat visit reminder). Walks every
 * clinic, creates a key only where the clinic has none, never changes an
 * existing row (admin texts and switches stay as they are).
 *
 * It used to create `reminder.5h` too, an active «за 5 часов» reminder, in
 * every clinic without that key, and NEW-CLINIC.md runs it at onboarding:
 * a new clinic's patients got «за 5 часов» and «за 3 часа» almost back to
 * back on top of the 5d / 3d / 1d / 3h cascade (audit G2-10). The cascade
 * is seeded by seed-notification-templates.ts and kept by
 * reminder-cadence-5d3d1d3h.ts; this script adds no reminder before a visit.
 *
 * DRY RUN by default; APPLY=1 writes.
 *   docker compose run --rm -e APPLY=1 worker npx tsx scripts/backfill-new-templates.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const APPLY = process.env.APPLY === "1";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const NEW_TEMPLATES = [
  {
    key: "case.repeat-due",
    nameRu: "Бесплатный повторный визит",
    nameUz: "Bepul takroriy qabul",
    category: "REMINDER" as const,
    trigger: "CASE_REPEAT_DUE" as const,
    triggerConfig: { daysBefore: 2 },
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! У вас осталось {{case.daysLeft}} дн. на бесплатный повторный приём в {{clinic.name}}. Запишитесь до {{case.deadline}}. Тел: {{clinic.phone}}.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! {{clinic.name}}da bepul takroriy qabulga {{case.daysLeft}} kun qoldi. {{case.deadline}} gacha yozilib oling. Tel: {{clinic.phone}}.",
    variables: [
      "patient.firstName",
      "case.daysLeft",
      "case.deadline",
      "clinic.name",
      "clinic.phone",
    ],
  },
];

async function main() {
  const clinics = await prisma.clinic.findMany({
    select: { id: true, slug: true, nameRu: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Found ${clinics.length} clinic(s)`);

  let createdCount = 0;
  let skippedCount = 0;

  for (const clinic of clinics) {
    for (const t of NEW_TEMPLATES) {
      const existing = await prisma.notificationTemplate.findUnique({
        where: { clinicId_key: { clinicId: clinic.id, key: t.key } },
        select: { id: true },
      });

      if (existing) {
        skippedCount++;
        console.log(`  [skip] ${clinic.slug} :: ${t.key} (already exists)`);
        continue;
      }

      if (!APPLY) {
        createdCount++;
        console.log(`  [+]    ${clinic.slug} :: ${t.key} (dry run)`);
        continue;
      }
      await prisma.notificationTemplate.create({
        data: {
          clinicId: clinic.id,
          key: t.key,
          nameRu: t.nameRu,
          nameUz: t.nameUz,
          channel: "TG",
          category: t.category,
          trigger: t.trigger,
          triggerConfig: t.triggerConfig as any,
          bodyRu: t.bodyRu,
          bodyUz: t.bodyUz,
          variables: t.variables,
          isActive: true,
        },
      });
      createdCount++;
      console.log(`  [+]    ${clinic.slug} :: ${t.key}`);
    }
  }

  console.log(
    `\nDone. Created: ${createdCount}, skipped: ${skippedCount}` +
      (APPLY ? "" : "\nDRY RUN, nothing written. APPLY=1 writes."),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
