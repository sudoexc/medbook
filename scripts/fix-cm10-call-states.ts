/**
 * Audit CM-07 / CM-10 data fix: calls closed under the old rules.
 *
 * Before the fix:
 *   - the SIP hangup of a call nobody answered set status MISSED but left
 *     direction IN, and wrote the ringing time as `durationSec`, so the
 *     missed counters (they read direction) never saw it and the funnel
 *     counted it as a conversation;
 *   - an answered call's `durationSec` included the ringing before the answer;
 *   - the operator's «Завершить» / «Пропуск» wrote only `endedAt` (plus a
 *     `missed` tag), so those calls stayed RINGING / ANSWERED for good.
 *
 * What it changes (each rule only touches rows still in the old state):
 *   1. status MISSED, direction IN → direction MISSED, durationSec null.
 *   2. endedAt set, status RINGING or ANSWERED, tagged `missed` →
 *      status MISSED (+ direction MISSED for IN), durationSec null.
 *   3. endedAt set, status RINGING or ANSWERED, not tagged → status ENDED,
 *      durationSec = talk time when `answeredAt` is known, else null.
 *   4. status ENDED with answeredAt and endedAt → durationSec = talk time.
 * Calls without `answeredAt` keep whatever duration they have in rule 4: no
 * answer moment is known to compute it from.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-cm10-call-states.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-cm10-call-states.ts
 *
 * Idempotent: a second run finds nothing to change.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

function talkSeconds(answeredAt: Date | null, endedAt: Date): number | null {
  if (!answeredAt) return null;
  return Math.max(0, Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000));
}

async function main() {
  // 1. Unanswered hangups that stayed inbound.
  const missedIn = await prisma.call.findMany({
    where: { status: "MISSED", direction: "IN" },
    select: { id: true },
  });

  // 2 + 3. Closed by an operator without a status.
  const closedOpen = await prisma.call.findMany({
    where: { endedAt: { not: null }, status: { in: ["RINGING", "ANSWERED"] } },
    select: {
      id: true,
      direction: true,
      tags: true,
      answeredAt: true,
      endedAt: true,
    },
  });
  const markedMissed = closedOpen.filter((c) => c.tags.includes("missed"));
  const endedByOperator = closedOpen.filter((c) => !c.tags.includes("missed"));

  // 4. Answered calls whose duration counted the ringing.
  const ended = await prisma.call.findMany({
    where: {
      status: "ENDED",
      answeredAt: { not: null },
      endedAt: { not: null },
    },
    select: { id: true, answeredAt: true, endedAt: true, durationSec: true },
  });
  const wrongDuration = ended.filter(
    (c) => talkSeconds(c.answeredAt, c.endedAt!) !== c.durationSec,
  );

  console.log(`[cm10] MISSED calls still inbound: ${missedIn.length}`);
  console.log(`[cm10] operator «Пропуск» left open: ${markedMissed.length}`);
  console.log(`[cm10] operator «Завершить» left open: ${endedByOperator.length}`);
  console.log(`[cm10] answered calls with ringing in the duration: ${wrongDuration.length}`);

  if (!APPLY) {
    console.log("[cm10] DRY RUN. Set APPLY=1 to write.");
    return;
  }

  const r1 = await prisma.call.updateMany({
    where: { id: { in: missedIn.map((c) => c.id) }, status: "MISSED", direction: "IN" },
    data: { direction: "MISSED", durationSec: null },
  });
  let r2 = 0;
  for (const c of markedMissed) {
    const res = await prisma.call.updateMany({
      where: { id: c.id, status: { in: ["RINGING", "ANSWERED"] } },
      data: {
        status: "MISSED",
        durationSec: null,
        ...(c.direction === "IN" ? { direction: "MISSED" as const } : {}),
      },
    });
    r2 += res.count;
  }
  let r3 = 0;
  for (const c of endedByOperator) {
    const res = await prisma.call.updateMany({
      where: { id: c.id, status: { in: ["RINGING", "ANSWERED"] } },
      data: { status: "ENDED", durationSec: talkSeconds(c.answeredAt, c.endedAt!) },
    });
    r3 += res.count;
  }
  let r4 = 0;
  for (const c of wrongDuration) {
    const res = await prisma.call.updateMany({
      where: { id: c.id, status: "ENDED" },
      data: { durationSec: talkSeconds(c.answeredAt, c.endedAt!) },
    });
    r4 += res.count;
  }
  console.log(
    `[cm10] updated: inbound missed ${r1.count}, «Пропуск» ${r2}, «Завершить» ${r3}, durations ${r4}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
