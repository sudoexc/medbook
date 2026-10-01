/**
 * Audit TG-22 data fix: more than one active template for one automatic
 * message.
 *
 * Onboarding seeded `reminder.24h` (APPOINTMENT_BEFORE, -1440) and the
 * «Авто-сообщения» widget then created `appointment.reminder-24h` with the
 * same offset; seeds added `reminder.feedback` next to the widget's
 * «Спасибо за визит» (both APPOINTMENT_COMPLETED). The dispatcher picked one
 * of them at random, so the widget's switch and text could have no effect.
 * Saving a template now switches its rivals off and the pick order is fixed
 * (most recently edited first); this script brings existing data to the
 * same state: per clinic and slot (`templateSlot`) the most recently edited
 * active template stays on, the others are switched off. Nothing is deleted;
 * an admin can switch a row back on in /crm/notifications.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-tg22-duplicate-templates.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-tg22-duplicate-templates.ts
 *
 * Idempotent: once every slot holds one active template, nothing matches.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { templateSlot } from "../src/server/notifications/template-events";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

async function main() {
  const rows = await prisma.notificationTemplate.findMany({
    where: { isActive: true },
    select: {
      id: true,
      clinicId: true,
      key: true,
      nameRu: true,
      trigger: true,
      triggerConfig: true,
      updatedAt: true,
    },
    // The dispatcher's pick order: the first row of a slot is the one sent.
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });

  const kept = new Map<string, (typeof rows)[number]>();
  const retire: Array<{ row: (typeof rows)[number]; keeper: (typeof rows)[number] }> = [];
  for (const row of rows) {
    const slot = templateSlot(row);
    if (!slot) continue;
    const k = `${row.clinicId}|${slot}`;
    const keeper = kept.get(k);
    if (!keeper) kept.set(k, row);
    else retire.push({ row, keeper });
  }

  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${retire.length} duplicate active templates`,
  );
  for (const { row, keeper } of retire) {
    console.log(
      `  clinic ${row.clinicId} ${templateSlot(row)}: off «${row.key}» (${row.nameRu}), kept «${keeper.key}»`,
    );
  }

  if (APPLY && retire.length > 0) {
    const res = await prisma.notificationTemplate.updateMany({
      where: { id: { in: retire.map((r) => r.row.id) }, isActive: true },
      data: { isActive: false },
    });
    console.log(`└─ switched off: ${res.count}`);
  } else {
    console.log(
      `└─ would switch off: ${retire.length}` +
        (APPLY ? "" : ". Nothing written; run again with APPLY=1"),
    );
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
