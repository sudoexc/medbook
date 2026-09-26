/**
 * Audit Q-12 data fix: give every existing doctor a ticket letter.
 *
 * Queue tickets used to take their letter from the first character of the
 * doctor's cuid id, which is always "c": both doctors printed C-001, C-002…
 * at the same time and the board calling «C-005» stood up two patients. The
 * letter now lives in `Doctor.ticketPrefix` (unique within the clinic, new
 * doctors get one on create). Rows that existed before the migration have
 * none and print the bare number until this script runs.
 *
 * Per clinic, doctors without a letter get the next free one (A, B, C…, I and
 * O skipped, see TICKET_PREFIX_ALPHABET) in this order: active doctors first,
 * then the ones who saw the most patients in the last 30 days, then the
 * oldest. So the doctors actually taking the queue get A and B. The admin can
 * change any letter later on the doctor's page.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-q12-ticket-prefixes.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-q12-ticket-prefixes.ts
 *
 * Idempotent: a doctor who already has a letter keeps it and is skipped, and
 * each write only lands while the row still has none.
 *
 * Run it before the clinic opens: a ticket printed earlier the same day shows
 * the old number while the board already shows the new letter.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { nextTicketPrefix } from "../src/server/services/ticket-number";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const RECENT_DAYS = 30;

async function main() {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const clinics = await prisma.clinic.findMany({
    select: { id: true, slug: true },
    orderBy: { createdAt: "asc" },
  });

  const plan: Array<{
    clinic: string;
    doctorId: string;
    name: string;
    prefix: string;
  }> = [];

  for (const clinic of clinics) {
    const doctors = await prisma.doctor.findMany({
      where: { clinicId: clinic.id },
      select: {
        id: true,
        nameRu: true,
        isActive: true,
        createdAt: true,
        ticketPrefix: true,
        _count: {
          select: { appointments: { where: { date: { gte: since } } } },
        },
      },
    });
    const taken = new Set(
      doctors.flatMap((d) => (d.ticketPrefix ? [d.ticketPrefix] : [])),
    );
    const missing = doctors
      .filter((d) => !d.ticketPrefix)
      .sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) ||
          b._count.appointments - a._count.appointments ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    for (const d of missing) {
      const prefix = nextTicketPrefix(taken);
      taken.add(prefix);
      plan.push({ clinic: clinic.slug, doctorId: d.id, name: d.nameRu, prefix });
    }
  }

  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${plan.length} doctors without a ticket letter`,
  );
  for (const p of plan) {
    console.log(`  ${p.clinic}  ${p.prefix}  ${p.name} (${p.doctorId})`);
  }

  if (!APPLY) {
    console.log("└─ nothing written; run again with APPLY=1");
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  let clashed = 0;
  for (const p of plan) {
    // Only while the row still has no letter: an admin who set one between
    // the read and this write keeps theirs.
    try {
      const res = await prisma.doctor.updateMany({
        where: { id: p.doctorId, ticketPrefix: null },
        data: { ticketPrefix: p.prefix },
      });
      written += res.count;
    } catch (e) {
      // An admin took this letter for another doctor meanwhile (unique
      // index). Skip; a second run picks the next free one.
      if ((e as { code?: string }).code !== "P2002") throw e;
      clashed += 1;
      console.log(`  skipped ${p.doctorId}: ${p.prefix} was just taken`);
    }
  }
  console.log(
    `└─ ${written} doctors updated${clashed ? `, ${clashed} skipped (run again)` : ""}`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
