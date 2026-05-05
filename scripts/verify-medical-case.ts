import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const apptTotal = await prisma.appointment.count();
  const apptLinked = await prisma.appointment.count({
    where: { medicalCaseId: { not: null } },
  });
  const apptUnlinked = apptTotal - apptLinked;
  const caseCount = await prisma.medicalCase.count();
  console.log("Appointment total:        ", apptTotal);
  console.log("Appointment linked:       ", apptLinked);
  console.log("Appointment unlinked:     ", apptUnlinked);
  console.log("MedicalCase rows:         ", caseCount);

  const expected = await prisma.$queryRawUnsafe<{ expected: number }[]>(`
    WITH ordered AS (
      SELECT a.id, a."clinicId" cid, a."patientId" pid, a."doctorId" did, a."date" d,
             LAG(a."date") OVER (PARTITION BY a."clinicId", a."patientId", a."doctorId" ORDER BY a."date", a.id) prev
      FROM "Appointment" a
    ),
    flagged AS (
      SELECT CASE WHEN prev IS NULL OR d - prev > INTERVAL '60 days' THEN 1 ELSE 0 END AS brk
      FROM ordered
    )
    SELECT COALESCE(SUM(brk),0)::int AS expected FROM flagged
  `);
  console.log("Expected case clusters:   ", expected[0]?.expected ?? 0);

  const statusBreakdown = await prisma.medicalCase.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log("Status breakdown:", statusBreakdown);

  const fkCheck = await prisma.$queryRawUnsafe<
    { conname: string; def: string }[]
  >(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE (conrelid = '"MedicalCase"'::regclass OR conrelid = '"Appointment"'::regclass)
      AND (conname ILIKE '%medical%')
    ORDER BY conname
  `);
  console.log("FKs:");
  for (const f of fkCheck) console.log("  ", f.conname, "→", f.def);

  const idxCheck = await prisma.$queryRawUnsafe<
    { indexname: string; indexdef: string }[]
  >(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename IN ('MedicalCase', 'Appointment')
      AND (indexname ILIKE '%medical%' OR indexname = 'MedicalCase_pkey')
    ORDER BY indexname
  `);
  console.log("Indexes:");
  for (const i of idxCheck) console.log("  ", i.indexname);

  const crossTenant = await prisma.$queryRawUnsafe<{ n: number }[]>(`
    SELECT count(*)::int AS n FROM "Appointment" a
    JOIN "MedicalCase" mc ON mc.id = a."medicalCaseId"
    WHERE a."clinicId" <> mc."clinicId"
  `);
  console.log("Cross-tenant violations:  ", crossTenant[0].n);

  // Sanity: a case's appointments are all from the same patient & doctor
  const integrityCheck = await prisma.$queryRawUnsafe<{ n: number }[]>(`
    SELECT count(*)::int AS n FROM "Appointment" a
    JOIN "MedicalCase" mc ON mc.id = a."medicalCaseId"
    WHERE a."patientId" <> mc."patientId"
       OR a."doctorId"  <> mc."primaryDoctorId"
  `);
  console.log("Patient/doctor mismatch:  ", integrityCheck[0].n);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
