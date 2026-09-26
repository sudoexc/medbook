/**
 * Audit LD-10 data fix: phones stored without the Uzbek country code.
 *
 * normalizePhone() used to add +998 only to 9-digit numbers starting with 9.
 * A number on any other operator or area code (33, 88, 77, 55, 50, 20, a 71
 * landline…) typed without the country code, «33 412 55 67» at the desk or
 * in the walk-in dialog, was stored as «+334125567»: nine digits behind a
 * "+", a number nobody can dial and that no lookup by the full
 * «+998 33 412 55 67» finds, so the same person came back as a new card.
 * normalizePhone now adds +998 to every 9-digit number; this script brings
 * the rows written before that to the same form:
 *
 *   Patient.phoneNormalized "+334125567" → "+998334125567", and
 *   Patient.phone too when it holds the same nine digits (it was written by
 *   normalizePhone, or typed as those digits);
 *   Lead.phone "+334125567" → "+998334125567".
 *
 * Only the exact shape "+" plus nine digits is touched: stubs (`tg:`,
 * `family:`, `contact:`, `retired:`) and real international numbers are
 * longer or not digits at all.
 *
 * A patient whose corrected number already belongs to another card of the
 * same clinic is NOT rewritten (phoneNormalized is unique per clinic): both
 * cards are listed as a likely duplicate for reception to merge by hand.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-ld10-local-phones.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-ld10-local-phones.ts
 *
 * Idempotent: a fixed row no longer has the nine-digit shape, and each write
 * only lands while the row still holds the value that was read.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePhone } from "../src/lib/phone";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

/** "+" and exactly nine digits: what the old rule made of a local number. */
const LOCAL_ONLY = /^\+\d{9}$/;

function digitsOf(v: string): string {
  return v.replace(/\D/g, "");
}

async function main() {
  const patients = (
    await prisma.patient.findMany({
      where: { phoneNormalized: { startsWith: "+" } },
      select: {
        id: true,
        clinicId: true,
        patientNumber: true,
        phone: true,
        phoneNormalized: true,
      },
    })
  ).filter((p) => LOCAL_ONLY.test(p.phoneNormalized));

  const patientPlan: Array<{
    id: string;
    patientNumber: number;
    from: string;
    to: string;
    phone: string | null;
  }> = [];
  const duplicates: Array<{
    id: string;
    patientNumber: number;
    from: string;
    to: string;
    ownerId: string;
    ownerNumber: number;
  }> = [];

  for (const p of patients) {
    const to = normalizePhone(p.phoneNormalized);
    const owner = await prisma.patient.findFirst({
      where: { clinicId: p.clinicId, phoneNormalized: to },
      select: { id: true, patientNumber: true },
    });
    if (owner) {
      duplicates.push({
        id: p.id,
        patientNumber: p.patientNumber,
        from: p.phoneNormalized,
        to,
        ownerId: owner.id,
        ownerNumber: owner.patientNumber,
      });
      continue;
    }
    patientPlan.push({
      id: p.id,
      patientNumber: p.patientNumber,
      from: p.phoneNormalized,
      to,
      // The display column follows only when it is the same nine digits; a
      // number typed some other way is left as the person wrote it.
      phone: digitsOf(p.phone) === digitsOf(p.phoneNormalized) ? to : null,
    });
  }

  const leads = (
    await prisma.lead.findMany({
      where: { phone: { startsWith: "+" } },
      select: { id: true, phone: true },
    })
  ).filter((l) => LOCAL_ONLY.test(l.phone));

  console.log(`┌─ ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`│ patients to fix: ${patientPlan.length}`);
  for (const p of patientPlan) {
    console.log(`│   P-${p.patientNumber} (${p.id})  ${p.from} → ${p.to}${p.phone ? " (phone too)" : ""}`);
  }
  console.log(`│ likely duplicates, left for reception to merge: ${duplicates.length}`);
  for (const d of duplicates) {
    console.log(`│   P-${d.patientNumber} (${d.id}) ${d.from} is P-${d.ownerNumber} (${d.ownerId}) ${d.to}`);
  }
  console.log(`│ leads to fix: ${leads.length}`);
  for (const l of leads) {
    console.log(`│   ${l.id}  ${l.phone} → ${normalizePhone(l.phone)}`);
  }

  if (!APPLY) {
    console.log("└─ nothing written; run again with APPLY=1");
    await prisma.$disconnect();
    return;
  }

  let patientsWritten = 0;
  let clashed = 0;
  for (const p of patientPlan) {
    try {
      // Only while the row still holds what was read: a number staff
      // corrected in the meantime stays theirs.
      const res = await prisma.patient.updateMany({
        where: { id: p.id, phoneNormalized: p.from },
        data: { phoneNormalized: p.to, ...(p.phone ? { phone: p.phone } : {}) },
      });
      patientsWritten += res.count;
    } catch (e) {
      // Another card took the corrected number between the read and this
      // write (unique per clinic). Skip; a second dry run lists it as a
      // duplicate.
      if ((e as { code?: string }).code !== "P2002") throw e;
      clashed += 1;
      console.log(`  skipped P-${p.patientNumber}: ${p.to} was just taken`);
    }
  }

  let leadsWritten = 0;
  for (const l of leads) {
    const res = await prisma.lead.updateMany({
      where: { id: l.id, phone: l.phone },
      data: { phone: normalizePhone(l.phone) },
    });
    leadsWritten += res.count;
  }

  console.log(
    `└─ patients written: ${patientsWritten}, clashed: ${clashed}; leads written: ${leadsWritten}`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
