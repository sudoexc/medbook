/**
 * One-off: backfill normalized phone values for legacy Lead and Patient rows
 * created before src/lib/phone.ts existed. Run with: `npx tsx prisma/normalize-phones.ts`
 *
 * Idempotent — running twice is a no-op.
 *
 * Patient has a UNIQUE(phone) index, so if normalization would collide with an
 * existing patient we merge: point any leads + appointments at the canonical
 * patient and delete the duplicate.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { normalizePhone } from "../src/lib/phone";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  let leadsUpdated = 0;
  const leads = await prisma.lead.findMany({ select: { id: true, phone: true } });
  for (const l of leads) {
    const n = normalizePhone(l.phone);
    if (n && n !== l.phone) {
      await prisma.lead.update({ where: { id: l.id }, data: { phone: n } });
      leadsUpdated++;
    }
  }

  let patientsUpdated = 0;
  let patientsMerged = 0;
  const patients = await prisma.patient.findMany({ select: { id: true, phone: true } });
  for (const p of patients) {
    const n = normalizePhone(p.phone);
    if (!n || n === p.phone) continue;

    const canonical = await prisma.patient.findUnique({ where: { phone: n } });
    if (canonical && canonical.id !== p.id) {
      // Merge: move dependent rows to canonical, then delete this duplicate.
      await prisma.appointment.updateMany({
        where: { patientId: p.id },
        data: { patientId: canonical.id },
      });
      await prisma.patient.delete({ where: { id: p.id } });
      patientsMerged++;
    } else {
      await prisma.patient.update({ where: { id: p.id }, data: { phone: n } });
      patientsUpdated++;
    }
  }

  console.log(`Leads normalized: ${leadsUpdated}`);
  console.log(`Patients normalized: ${patientsUpdated}`);
  console.log(`Duplicate patients merged: ${patientsMerged}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
