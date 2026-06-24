/**
 * Clears all generated demo domain data for the neurofax clinic, returning it
 * to the "fresh clinic shell" state: doctors, services, cabinets, users,
 * schedules and notification templates are preserved; every patient-derived
 * row (appointments, payments, conversations, documents, leads, audit, …) is
 * deleted. Scoped strictly by clinicId — only tables that actually have a
 * clinicId column are touched.
 *
 * This is the WIPE phase of seed-mega-neurofax.ts, extracted to run on its own
 * with NO re-seed. Irreversible.
 *
 * Run from the worker container:
 *   docker compose exec -T worker npx tsx scripts/wipe-neurofax-demo.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

// Child-before-parent order so FK constraints don't block the deletes.
const wipeOrder = [
  "MessageRead",
  "Message",
  "Conversation",
  "MedicationReminderSend",
  "Reminder",
  "NotificationSend",
  "Campaign",
  "AppointmentService",
  "Payment",
  "Invoice",
  "Document",
  "Communication",
  "VisitNote",
  "Prescription",
  "EPrescription",
  "SickLeave",
  "LabResult",
  "LabOrder",
  "CdsOverride",
  "PatientReview",
  "PatientFamily",
  "PatientAllergy",
  "PatientChronicCondition",
  "PatientDiagnosis",
  "PatientView",
  "Review",
  "Appointment",
  "MedicalCase",
  "Call",
  "OnlineRequest",
  "Lead",
  "Action",
  "EmptySlotSnapshot",
  "ReferralReward",
  "DataExportJob",
  "DataDeletionJob",
  "AuditLog",
  "LLMUsage",
  "Patient",
];

async function main() {
  const clinic = await prisma.clinic.findUnique({ where: { slug: "neurofax" } });
  if (!clinic) throw new Error("clinic 'neurofax' not found");
  const clinicId = clinic.id;
  console.log(`┌─ WIPE neurofax demo (clinic ${clinicId})`);

  const tableColumns = await prisma.$queryRawUnsafe<
    { table_name: string; column_name: string }[]
  >(
    `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'clinicId'`,
  );
  const hasClinicId = new Set(tableColumns.map((r) => r.table_name));

  let totalDeleted = 0;
  for (const table of wipeOrder) {
    if (!hasClinicId.has(table)) {
      console.log(`  · ${table}: (no clinicId column, skip)`);
      continue;
    }
    try {
      const res = await prisma.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "clinicId" = $1`,
        clinicId,
      );
      if (res > 0) {
        console.log(`  ✗ ${table}: -${res}`);
        totalDeleted += res;
      }
    } catch (e: any) {
      console.warn(`  ! ${table}: ${e.message?.slice(0, 160) ?? e}`);
    }
  }

  // Reset patient counter so a future seed starts at P-00001.
  await prisma.clinic.update({
    where: { id: clinicId },
    data: { patientCounter: 0 },
  });
  console.log(`└─ wipe done — ${totalDeleted} rows deleted, reference data kept\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ wipe failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
