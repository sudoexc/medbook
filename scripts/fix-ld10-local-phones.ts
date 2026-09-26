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
 *   Patient.phone "+334125567" → "+998334125567" on a relative who uses
 *   someone's number (a `contact:` stub in phoneNormalized, audit Q-03): the
 *   number lives only in `phone` there, and that is the column the walk-in
 *   looks him up by and his prints show;
 *   Lead.phone "+334125567" → "+998334125567".
 *
 * Only the exact shape "+" plus nine digits is touched: stubs (`tg:`,
 * `family:`, `contact:`, `retired:`) and real international numbers are
 * longer or not digits at all.
 *
 * A patient whose corrected number already belongs to another card of the
 * same clinic is NOT rewritten (phoneNormalized is unique per clinic): both
 * cards are listed with their names and birth years for reception. Such a
 * pair is often two people on one family number (the old lookup of the full
 * number never saw the short shape, so a son typed with 998 got his own
 * card next to his mother's): reception checks who is who before merging
 * anything. A relative's contact phone never clashes: his phoneNormalized
 * stays the stub.
 *
 * WHEN: run with APPLY=1 right after the deploy that ships LD-10. Lookups
 * try the old shape as well (phoneSearchVariants), so a returning patient is
 * still found before the run, but until it the cards show and dial a number
 * nobody can reach.
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

/** "+" and exactly nine digits: what the old rule made of a local number. */
const LOCAL_ONLY = /^\+\d{9}$/;

/** `phoneNormalized` prefix of a relative using someone's number (Q-03). */
const CONTACT_PREFIX = "contact:";

function digitsOf(v: string): string {
  return v.replace(/\D/g, "");
}

type CardLabel = {
  id: string;
  patientNumber: number;
  fullName: string;
  birthDate: Date | null;
};

/** «P-10 Каримова Дилноза, 1985 (id)», the way reception tells cards apart. */
function cardLabel(c: CardLabel): string {
  const year = c.birthDate ? `, ${c.birthDate.getUTCFullYear()}` : ", birth year unknown";
  return `P-${c.patientNumber} ${c.fullName}${year} (${c.id})`;
}

/** The tables this fix reads and writes; the unit test passes a fake. */
export type Ld10Db = Pick<PrismaClient, "patient" | "lead">;

export type Ld10Summary = {
  patientsWritten: number;
  clashed: number;
  /** Cards left in the old shape because another card holds the new one. */
  sameNumber: number;
  contactPhonesWritten: number;
  leadsWritten: number;
};

export async function fixLd10LocalPhones(
  db: Ld10Db,
  apply: boolean,
  log: (line: string) => void = console.log,
): Promise<Ld10Summary> {
  const patients = (
    await db.patient.findMany({
      where: { phoneNormalized: { startsWith: "+" } },
      select: {
        id: true,
        clinicId: true,
        patientNumber: true,
        fullName: true,
        birthDate: true,
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
  // Both cards as reception will see them: a name and a birth year tell a
  // mother from her son; P-numbers and ids alone read as one person twice.
  const sameNumber: Array<{
    card: CardLabel;
    from: string;
    to: string;
    owner: CardLabel;
  }> = [];

  for (const p of patients) {
    const to = normalizePhone(p.phoneNormalized);
    const owner = await db.patient.findFirst({
      where: { clinicId: p.clinicId, phoneNormalized: to },
      select: { id: true, patientNumber: true, fullName: true, birthDate: true },
    });
    if (owner) {
      sameNumber.push({ card: p, from: p.phoneNormalized, to, owner });
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

  // A relative on someone's number keeps it in `phone` behind a `contact:`
  // stub, written by the same old normalizer. The rewrite above moves the
  // owner to +998… and would leave him behind in the old shape: his prints
  // keep a number nobody can dial, and he is found only through the old
  // shape phoneSearchVariants still tries.
  const contactPhones = (
    await db.patient.findMany({
      where: {
        phoneNormalized: { startsWith: CONTACT_PREFIX },
        phone: { startsWith: "+" },
      },
      select: { id: true, patientNumber: true, phone: true },
    })
  )
    .filter((p) => LOCAL_ONLY.test(p.phone))
    .map((p) => ({
      id: p.id,
      patientNumber: p.patientNumber,
      from: p.phone,
      to: normalizePhone(p.phone),
    }));

  const leads = (
    await db.lead.findMany({
      where: { phone: { startsWith: "+" } },
      select: { id: true, phone: true },
    })
  ).filter((l) => LOCAL_ONLY.test(l.phone));

  log(`┌─ ${apply ? "APPLY" : "DRY RUN"}`);
  log(`│ patients to fix: ${patientPlan.length}`);
  for (const p of patientPlan) {
    log(`│   P-${p.patientNumber} (${p.id})  ${p.from} → ${p.to}${p.phone ? " (phone too)" : ""}`);
  }
  log(
    `│ same number on two cards, left as is (often two people; check before merging): ${sameNumber.length}`,
  );
  for (const d of sameNumber) {
    log(`│   ${cardLabel(d.card)} ${d.from}`);
    log(`│     and ${cardLabel(d.owner)} ${d.to}`);
  }
  log(`│ relatives' contact phones to fix: ${contactPhones.length}`);
  for (const c of contactPhones) {
    log(`│   P-${c.patientNumber} (${c.id})  ${c.from} → ${c.to}`);
  }
  log(`│ leads to fix: ${leads.length}`);
  for (const l of leads) {
    log(`│   ${l.id}  ${l.phone} → ${normalizePhone(l.phone)}`);
  }

  const summary: Ld10Summary = {
    patientsWritten: 0,
    clashed: 0,
    sameNumber: sameNumber.length,
    contactPhonesWritten: 0,
    leadsWritten: 0,
  };
  if (!apply) {
    log("└─ nothing written; run again with APPLY=1");
    return summary;
  }

  for (const p of patientPlan) {
    try {
      // Only while the row still holds what was read: a number staff
      // corrected in the meantime stays theirs.
      const res = await db.patient.updateMany({
        where: { id: p.id, phoneNormalized: p.from },
        data: { phoneNormalized: p.to, ...(p.phone ? { phone: p.phone } : {}) },
      });
      summary.patientsWritten += res.count;
    } catch (e) {
      // Another card took the corrected number between the read and this
      // write (unique per clinic). Skip; a second dry run lists the pair.
      if ((e as { code?: string }).code !== "P2002") throw e;
      summary.clashed += 1;
      log(`  skipped P-${p.patientNumber}: ${p.to} was just taken`);
    }
  }

  for (const c of contactPhones) {
    // Same guard: still a contact sharer, still the number that was read.
    const res = await db.patient.updateMany({
      where: {
        id: c.id,
        phone: c.from,
        phoneNormalized: { startsWith: CONTACT_PREFIX },
      },
      data: { phone: c.to },
    });
    summary.contactPhonesWritten += res.count;
  }

  for (const l of leads) {
    const res = await db.lead.updateMany({
      where: { id: l.id, phone: l.phone },
      data: { phone: normalizePhone(l.phone) },
    });
    summary.leadsWritten += res.count;
  }

  log(
    `└─ patients written: ${summary.patientsWritten}, clashed: ${summary.clashed}; ` +
      `contact phones written: ${summary.contactPhonesWritten}; leads written: ${summary.leadsWritten}`,
  );
  return summary;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
  });
  try {
    await fixLd10LocalPhones(prisma, process.env.APPLY === "1");
  } finally {
    await prisma.$disconnect();
  }
}

// `tsx scripts/fix-ld10-local-phones.ts` is the entry point; the unit test
// imports fixLd10LocalPhones without touching a database.
if (process.argv[1]?.includes("fix-ld10-local-phones")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
