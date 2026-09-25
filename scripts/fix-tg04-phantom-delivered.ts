/**
 * Audit TG-04 data fix: staff messages shown as delivered that were never sent.
 *
 * A thread the clinic opened from the patient card («Написать в Telegram»,
 * the doctor's «Написать пациенту») had no bot chat id, and the send route
 * marked every message in it DELIVERED (two ticks) without calling Telegram.
 * Such a row is recognisable: an OUT message, DELIVERED, with no Telegram
 * message id (`externalId` null). Every real send stores that id, and inbound
 * messages are IN.
 *
 * These rows are marked FAILED with reason `not_sent`, so the chat shows
 * «Не доставлено: сообщение не было отправлено в Telegram» and staff can send
 * again what still matters. Nothing is re-sent automatically: an old «ждём
 * вас завтра в 10:00» must not reach a patient weeks later.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-tg04-phantom-delivered.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-tg04-phantom-delivered.ts
 *
 * Idempotent: a relabelled row is FAILED and no longer matches.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

const PHANTOM = {
  direction: "OUT",
  status: "DELIVERED",
  externalId: null,
} as const;

async function main() {
  const rows = await prisma.message.findMany({
    where: PHANTOM,
    select: {
      id: true,
      clinicId: true,
      createdAt: true,
      body: true,
      conversation: {
        select: { id: true, patient: { select: { fullName: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${rows.length} staff messages marked delivered but never sent`,
  );
  for (const m of rows) {
    const who = m.conversation.patient?.fullName ?? m.conversation.id;
    const text = (m.body ?? "").replace(/\s+/g, " ").slice(0, 60);
    console.log(`  ${m.createdAt.toISOString().slice(0, 16)} ${who}: ${text}`);
  }

  if (APPLY && rows.length > 0) {
    const res = await prisma.message.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, ...PHANTOM },
      data: { status: "FAILED", failedReason: "not_sent" },
    });
    console.log(`└─ marked FAILED (not_sent): ${res.count}`);
  } else {
    console.log(
      `└─ would mark FAILED (not_sent): ${rows.length}` +
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
