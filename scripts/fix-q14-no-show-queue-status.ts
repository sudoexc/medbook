/**
 * Audit Q-14 data fix: auto no-shows whose `queueStatus` was left behind.
 *
 * The lifecycle sweep flipped stale bookings to NO_SHOW by writing `status`
 * alone. Reception lays its lanes out by `queueStatus`, so every such row
 * still reads BOOKED / CONFIRMED / SKIPPED there: on a past day it shows
 * «Подтверждена» with a «Пришёл» button, and the queue-status route used to
 * let that button bring the no-show back to life. The sweep now writes both
 * columns; this aligns the rows it wrote before.
 *
 * What it changes: rows with status NO_SHOW whose queueStatus is anything
 * else get queueStatus NO_SHOW. Nothing else. Walk-ins the old sweep turned
 * into no-shows keep that status: they are past days, the patient was not
 * served after the skip, and no message is sent from here.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-q14-no-show-queue-status.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-q14-no-show-queue-status.ts
 *
 * Idempotent: a second run finds nothing to change, and each write only
 * lands while the row is still a NO_SHOW with a different queueStatus.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

async function main() {
  const drifted = await prisma.appointment.findMany({
    where: { status: "NO_SHOW", queueStatus: { not: "NO_SHOW" } },
    select: {
      id: true,
      clinicId: true,
      channel: true,
      queueStatus: true,
      date: true,
    },
    orderBy: { date: "asc" },
  });

  const byQueueStatus = new Map<string, number>();
  let walkins = 0;
  for (const row of drifted) {
    byQueueStatus.set(
      row.queueStatus,
      (byQueueStatus.get(row.queueStatus) ?? 0) + 1,
    );
    if (row.channel === "WALKIN") walkins += 1;
  }

  console.log(`[q14] NO_SHOW rows with a different queueStatus: ${drifted.length}`);
  for (const [qs, n] of byQueueStatus) console.log(`[q14]   queueStatus ${qs}: ${n}`);
  console.log(`[q14]   of them walk-ins: ${walkins}`);
  if (drifted.length > 0) {
    console.log(
      `[q14]   dates: ${drifted[0].date.toISOString()} .. ${drifted[drifted.length - 1].date.toISOString()}`,
    );
  }

  if (!APPLY) {
    console.log("[q14] DRY RUN. Set APPLY=1 to write.");
    return;
  }

  const res = await prisma.appointment.updateMany({
    where: {
      id: { in: drifted.map((r) => r.id) },
      status: "NO_SHOW",
      queueStatus: { not: "NO_SHOW" },
    },
    data: { queueStatus: "NO_SHOW" },
  });
  console.log(`[q14] updated: ${res.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
