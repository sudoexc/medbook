/**
 * Wipes all patient-facing test data while preserving the clinic config.
 *
 * KEPT (config / staff):
 *   - Doctor, DoctorSchedule, DoctorDayOff, Review
 *   - User, Account, Session, VerificationToken
 *
 * DELETED (transactional / patient data):
 *   - Payment      (FK → Patient, Appointment)
 *   - MedicalRecord (FK → Patient, Doctor, Appointment)
 *   - Appointment  (FK → Patient, Doctor, Lead)
 *   - Lead
 *   - Patient
 *
 * Run with: `npx tsx prisma/cleanup-test-data.ts`
 * Pass `--dry-run` to see counts without deleting.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const [
    payments,
    medicalRecords,
    appointments,
    leads,
    patients,
    doctors,
    users,
    reviews,
  ] = await Promise.all([
    prisma.payment.count(),
    prisma.medicalRecord.count(),
    prisma.appointment.count(),
    prisma.lead.count(),
    prisma.patient.count(),
    prisma.doctor.count(),
    prisma.user.count(),
    prisma.review.count(),
  ]);

  console.log("== Current state ==");
  console.log(`  Payments:        ${payments}`);
  console.log(`  MedicalRecords:  ${medicalRecords}`);
  console.log(`  Appointments:    ${appointments}`);
  console.log(`  Leads:           ${leads}`);
  console.log(`  Patients:        ${patients}`);
  console.log(`  --- preserved ---`);
  console.log(`  Doctors:         ${doctors}`);
  console.log(`  Users:           ${users}`);
  console.log(`  Reviews:         ${reviews}`);
  console.log("");

  if (dryRun) {
    console.log("Dry run — nothing deleted.");
    return;
  }

  console.log("== Deleting in FK-safe order ==");
  // Order matters: child rows before parents.
  const delPayments = await prisma.payment.deleteMany();
  console.log(`  payment.deleteMany       → ${delPayments.count}`);

  const delMedRecs = await prisma.medicalRecord.deleteMany();
  console.log(`  medicalRecord.deleteMany → ${delMedRecs.count}`);

  const delAppts = await prisma.appointment.deleteMany();
  console.log(`  appointment.deleteMany   → ${delAppts.count}`);

  const delLeads = await prisma.lead.deleteMany();
  console.log(`  lead.deleteMany          → ${delLeads.count}`);

  const delPatients = await prisma.patient.deleteMany();
  console.log(`  patient.deleteMany       → ${delPatients.count}`);

  console.log("");
  console.log("== After cleanup ==");
  const [a, l, p] = await Promise.all([
    prisma.appointment.count(),
    prisma.lead.count(),
    prisma.patient.count(),
  ]);
  console.log(`  Appointments: ${a}, Leads: ${l}, Patients: ${p}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
