/**
 * Review of audit G3-01 data fix: Mini App check-ins left on a visit that
 * reception moved to another day.
 *
 * «Я на месте» stamps `Appointment.arrivedAt` and the Mini App accepts it
 * only on the visit's day. A staff move used to keep the stamp, so a visit
 * moved from 01.10 to 08.10 arrived on 08.10 already «checked in at 09:10»:
 * the Mini App showed «Вы отметились» with no button, and the patient's real
 * tap could not reach the desk. Staff moves now drop the stamp
 * (`checkInResetOnMove`) and the CRM and the sweep ignore a stamp from
 * another day (`checkedInOnVisitDay`); this clears the stamps moved before.
 *
 * What it changes: bookings still waiting for their patient (BOOKED /
 * CONFIRMED) whose `arrivedAt` falls on another Tashkent day than the visit
 * get `arrivedAt` = null. Nothing else. A stamp on the visit's own day, and
 * every stamp on a visit already decided (arrived, done, missed, cancelled),
 * stays as history.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-g301-stale-check-ins.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-g301-stale-check-ins.ts
 *
 * Idempotent: a second run finds nothing to change, and each write lands
 * only while the row still carries the very stamp that was read and is
 * still a booking, so a fresh tap in between is never erased.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { checkedInOnVisitDay } from "../src/lib/appointments/self-check-in";
import { tashkentDateOf } from "../src/lib/tashkent-time";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const PRE_ARRIVAL = ["BOOKED", "CONFIRMED"] as const;

async function main() {
  const stamped = await prisma.appointment.findMany({
    where: { status: { in: [...PRE_ARRIVAL] }, arrivedAt: { not: null } },
    select: { id: true, clinicId: true, date: true, arrivedAt: true },
    orderBy: { date: "asc" },
  });
  const stale = stamped.filter((r) => !checkedInOnVisitDay(r));

  console.log(`[g301] bookings with a Mini App check-in: ${stamped.length}`);
  console.log(`[g301]   of them stamped on another day than the visit: ${stale.length}`);
  for (const r of stale) {
    console.log(
      `[g301]   ${r.id} clinic=${r.clinicId} visit ${tashkentDateOf(r.date)} tapped ${tashkentDateOf(r.arrivedAt!)}`,
    );
  }

  if (!APPLY) {
    console.log("[g301] DRY RUN. Set APPLY=1 to write.");
    return;
  }

  let cleared = 0;
  for (const r of stale) {
    const res = await prisma.appointment.updateMany({
      where: { id: r.id, arrivedAt: r.arrivedAt, status: { in: [...PRE_ARRIVAL] } },
      data: { arrivedAt: null },
    });
    cleared += res.count;
  }
  console.log(`[g301] cleared: ${cleared}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
