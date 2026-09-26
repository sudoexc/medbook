/**
 * Dev-only seed: doctor reminders and lab results, so the doctor screens have
 * something to render on a LOCAL database.
 *
 * Audit G2-02: it used to run over every clinic of the platform and give real
 * patients invented results (a CRITICAL cholesterol among them) and real
 * doctors reminder tasks, unmarked. Now:
 *   - refused with NODE_ENV=production (the worker image), no override, and
 *     on a clinic with real data unless ALLOW_DEMO_SEED_ON_REAL_DATA names it
 *     (scripts/_destructive-guard.ts);
 *   - one clinic, named explicitly with CLINIC_SLUG;
 *   - only patients tagged `demo-seed` (create them with seed-prod-demo.ts);
 *   - every row carries LABS_REMINDERS_MARK in Reminder.body / LabResult.notes,
 *     so it can be found and removed exactly:
 *       DELETE FROM "LabResult" WHERE notes = '[demo-seed:labs-reminders-dev]';
 *       DELETE FROM "Reminder"  WHERE body  = '[demo-seed:labs-reminders-dev]';
 *
 *   CLINIC_SLUG=neurofax npx tsx scripts/seed-labs-reminders-dev.ts
 *
 * Idempotent: a doctor who already has marked rows gets no more.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { DEMO_SEED_MARK } from "../src/lib/demo-seed";
import { assertSeedAllowed, requireClinicSlug } from "./_destructive-guard";
import { LABS_REMINDERS_MARK, planLabsReminders } from "./_labs-reminders-plan";

const SCRIPT = "seed-labs-reminders-dev";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const slug = requireClinicSlug(SCRIPT);
  const { clinicId } = await assertSeedAllowed(prisma, {
    script: SCRIPT,
    clinicSlug: slug,
    devOnly: true,
  });

  const [doctors, patients] = await Promise.all([
    prisma.user.findMany({
      where: { clinicId, role: "DOCTOR" },
      select: { id: true, name: true },
    }),
    prisma.patient.findMany({
      where: { clinicId, tags: { has: DEMO_SEED_MARK }, deletedAt: null },
      select: { id: true, tags: true },
      take: 50,
    }),
  ]);
  if (patients.length === 0) {
    console.log(
      `no demo patients (tag «${DEMO_SEED_MARK}») in ${slug}: run APPLY=1 npx tsx scripts/seed-prod-demo.ts first.`,
    );
    return;
  }

  const seededByDoctor = new Map<string, { reminders: number; labs: number }>();
  for (const d of doctors) {
    const [reminders, labs] = await Promise.all([
      prisma.reminder.count({ where: { clinicId, doctorId: d.id, body: LABS_REMINDERS_MARK } }),
      prisma.labResult.count({ where: { clinicId, doctorId: d.id, notes: LABS_REMINDERS_MARK } }),
    ]);
    seededByDoctor.set(d.id, { reminders, labs });
  }

  const plan = planLabsReminders({
    doctorIds: doctors.map((d) => d.id),
    patients,
    seededByDoctor,
    now: new Date(),
  });
  for (const r of plan.reminders) {
    await prisma.reminder.create({ data: { clinicId, status: "PENDING", ...r } });
  }
  for (const l of plan.labs) {
    await prisma.labResult.create({ data: { clinicId, status: "RESULTED", ...l } });
  }
  console.log(
    `[${slug}] +${plan.reminders.length} reminders, +${plan.labs.length} lab results (marked ${LABS_REMINDERS_MARK})`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
