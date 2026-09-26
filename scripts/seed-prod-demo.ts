/**
 * Demo patients for a demo clinic (audit G2-01). Written to be harmless next
 * to real rows (marked, idempotent, Tashkent times), but production neurofax
 * is the real clinic now: with APPLY=1 the shared guard refuses a clinic with
 * real data or NODE_ENV=production unless ALLOW_DEMO_SEED_ON_REAL_DATA names
 * it (audit G2-03, scripts/_destructive-guard.ts).
 *
 * What it does:
 *   - Keeps DEMO_COUNT (30) demo patients with phones in the +998 00 100 XX XX
 *     range: operator code 00 does not exist, so no real patient can own one.
 *     Every demo patient carries the tag `demo-seed`.
 *   - Gives a demo patient visits ONLY when it has none at all, so a re-run
 *     never adds rows (the old seed booked a fresh future visit per patient
 *     on every run, hundreds at a time).
 *   - Per such patient: one past COMPLETED visit with a PAID payment, and
 *     with `--with-future` also one future BOOKED visit. Future demo bookings
 *     are opt-in because they take real doctors' free slots and pull
 *     reminders and confirm-call tasks into the live action center.
 *   - Visits sit inside the doctor's own schedule in Tashkent time, in the
 *     doctor's own cabinet, with `time` filled and a schedule-lane channel
 *     (never WALKIN), and never overlap an existing visit of that doctor.
 *   - Marks: Patient.tags = ["demo-seed"], Appointment.notes = "[demo-seed]",
 *     Payment.externalRef = "demo-seed", Payment.idempotencyKey =
 *     "demo-seed:<appointmentId>". Demo rows can be found and removed.
 *
 * What it no longer does: upsert notification templates. It used to rewrite
 * every template of the clinic, reverting the TG-02 reminder text fix and any
 * admin wording. Missing templates are backfilled by
 * scripts/backfill-new-templates.ts.
 *
 * Dry run (default, writes nothing, prints the plan):
 *   docker compose exec -T worker npx tsx scripts/seed-prod-demo.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/seed-prod-demo.ts
 * Flags:
 *   --with-future                 also book one future visit per new patient
 * Env:
 *   DEMO_CLINIC_SLUG (default "neurofax")
 *   ALLOW_DEMO_SEED_ON_REAL_DATA=<slug>  required with APPLY=1 when the clinic
 *                                 holds real data or NODE_ENV=production
 *                                 (see _destructive-guard.ts). Production IS
 *                                 the real clinic: do not run this there.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { assertSeedAllowed } from "./_destructive-guard";
import {
  DEMO_APPOINTMENT_NOTE,
  DEMO_CHANNELS,
  DEMO_COUNT,
  DEMO_PAYMENT_REF,
  DEMO_TAG,
  candidateSlots,
  demoPhone,
  type PlannedSlot,
} from "./_demo-seed-plan";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const WITH_FUTURE = process.argv.slice(2).includes("--with-future");
const SLUG = process.env.DEMO_CLINIC_SLUG?.trim() || "neurofax";

const FIRST_NAMES = [
  "Азиза", "Иван", "Феруза", "Мухаммад", "Ойбек", "Сардор", "Камила", "Бобур",
  "Нигора", "Алишер", "Мадина", "Улугбек", "Гулнора", "Фарход", "Дилшод",
];
const LAST_NAMES = [
  "Каримов", "Усманов", "Юлдашев", "Хасанов", "Турсунов", "Махмудов", "Рахимов",
];

/** Deterministic picks: a re-run plans the same names and choices. */
function pickAt<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

type Doctor = {
  id: string;
  cabinetId: string;
  schedules: {
    weekday: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
    validFrom: Date | null;
    validTo: Date | null;
  }[];
};

async function main() {
  console.log(
    `seed-prod-demo: ${APPLY ? "APPLY" : "DRY RUN (set APPLY=1 to write)"}` +
      `${WITH_FUTURE ? ", with future visits" : ""}\n`,
  );

  const clinic = await prisma.clinic.findUnique({ where: { slug: SLUG } });
  if (!clinic) throw new Error(`[seed] clinic '${SLUG}' not found`);
  console.log(`✔ clinic: ${clinic.slug} (${clinic.id})`);

  if (APPLY) {
    await assertSeedAllowed(prisma, { script: "seed-prod-demo", clinicSlug: SLUG });
  }

  const branch = await prisma.branch.findFirst({
    where: { clinicId: clinic.id, isDefault: true, isActive: true },
    select: { id: true },
  });
  // Only doctors that can take a visit: active, with an active cabinet of
  // their own and a schedule. The cabinet is the doctor's, never random.
  const doctors: Doctor[] = (
    await prisma.doctor.findMany({
      where: {
        clinicId: clinic.id,
        isActive: true,
        cabinet: { isActive: true },
      },
      select: {
        id: true,
        cabinetId: true,
        schedules: {
          select: {
            weekday: true,
            startTime: true,
            endTime: true,
            isActive: true,
            validFrom: true,
            validTo: true,
          },
        },
      },
    })
  ).filter((d) => d.schedules.some((s) => s.isActive));
  const services = await prisma.service.findMany({
    where: { clinicId: clinic.id, isActive: true },
    select: { id: true, durationMin: true, priceBase: true },
  });
  if (doctors.length === 0 || services.length === 0) {
    throw new Error(
      `[seed] need scheduled doctors with a cabinet and services: got ${doctors.length}/${services.length}`,
    );
  }
  console.log(`  ${doctors.length} scheduled doctors · ${services.length} services`);

  const now = new Date();
  let patientsNew = 0;
  let apptsNew = 0;
  let paymentsNew = 0;
  let skipped = 0;

  for (let i = 0; i < DEMO_COUNT; i++) {
    const phoneNormalized = demoPhone(i);
    const existing = await prisma.patient.findUnique({
      where: {
        clinicId_phoneNormalized: { clinicId: clinic.id, phoneNormalized },
      },
      select: { id: true, tags: true },
    });

    let patientId: string | null = existing?.id ?? null;
    if (!existing) {
      patientsNew++;
      if (APPLY) {
        const created = await prisma.$transaction(async (tx) => {
          const c = await tx.clinic.update({
            where: { id: clinic.id },
            data: { patientCounter: { increment: 1 } },
            select: { patientCounter: true },
          });
          return tx.patient.create({
            data: {
              clinicId: clinic.id,
              patientNumber: c.patientCounter,
              fullName: `${pickAt(LAST_NAMES, i)} ${pickAt(FIRST_NAMES, i * 7 + 3)}`,
              phone: phoneNormalized,
              phoneNormalized,
              gender: i % 2 === 0 ? "MALE" : "FEMALE",
              segment: pickAt(["NEW", "ACTIVE", "DORMANT", "VIP"] as const, i),
              preferredChannel: "TG",
              preferredLang: "RU",
              tags: [DEMO_TAG],
              notes: "Демо-пациент (seed-prod-demo).",
            },
            select: { id: true },
          });
        });
        patientId = created.id;
      }
    } else if (!existing.tags.includes(DEMO_TAG)) {
      // A number from the unassigned 00 range can only be ours: stamp the
      // marker on rows an earlier run of this version created without it.
      if (APPLY) {
        await prisma.patient.update({
          where: { id: existing.id },
          data: { tags: { push: DEMO_TAG } },
        });
      }
    }

    // Idempotency: visits are created only for a patient with none at all.
    // The old seed topped up a future visit on every run.
    if (patientId) {
      const any = await prisma.appointment.count({
        where: { clinicId: clinic.id, patientId },
      });
      if (any > 0) continue;
    }

    const kinds: Array<"past" | "future"> = WITH_FUTURE
      ? ["past", "future"]
      : ["past"];
    for (const kind of kinds) {
      const doctor = pickAt(doctors, i + (kind === "future" ? 1 : 0));
      const service = pickAt(services, i);
      const slot = await firstFreeSlot(doctor, {
        kind,
        durationMin: service.durationMin,
        now,
        seed: i,
      });
      if (!slot) {
        skipped++;
        console.warn(`  [skip ${kind}] demo #${i}: no free slot in the schedule`);
        continue;
      }
      apptsNew++;
      if (kind === "past") paymentsNew++;
      if (!APPLY || !patientId) continue;

      const status = kind === "past" ? "COMPLETED" : "BOOKED";
      try {
        await prisma.$transaction(async (tx) => {
          const appt = await tx.appointment.create({
            data: {
              clinicId: clinic.id,
              branchId: branch?.id ?? null,
              patientId: patientId!,
              doctorId: doctor.id,
              cabinetId: doctor.cabinetId,
              serviceId: service.id,
              date: slot.date,
              time: slot.time,
              durationMin: service.durationMin,
              endDate: slot.endDate,
              status,
              queueStatus: status,
              channel: pickAt(DEMO_CHANNELS, i),
              priceService: service.priceBase,
              priceBase: service.priceBase,
              priceFinal: service.priceBase,
              notes: DEMO_APPOINTMENT_NOTE,
              completedAt: kind === "past" ? slot.endDate : null,
            },
            select: { id: true },
          });
          await tx.appointmentService.create({
            data: {
              clinicId: clinic.id,
              appointmentId: appt.id,
              serviceId: service.id,
              priceSnap: service.priceBase,
              quantity: 1,
            },
          });
          if (kind === "past") {
            await tx.payment.create({
              data: {
                clinicId: clinic.id,
                appointmentId: appt.id,
                patientId: patientId!,
                currency: "UZS",
                amount: service.priceBase,
                method: pickAt(["CASH", "CARD", "PAYME", "CLICK"] as const, i),
                status: "PAID",
                paidAt: slot.endDate,
                externalRef: DEMO_PAYMENT_REF,
                idempotencyKey: `${DEMO_TAG}:${appt.id}`,
              },
            });
          }
        });
      } catch (e) {
        // A visit booked between the overlap check and the insert trips the
        // doctor overlap constraint; the patient simply stays without it.
        skipped++;
        apptsNew--;
        if (kind === "past") paymentsNew--;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`  [skip ${kind}] demo #${i}: ${msg.slice(0, 160)}`);
      }
    }
  }

  const verb = APPLY ? "" : " (would be)";
  console.log(`✔ patients: +${patientsNew}${verb}`);
  console.log(`✔ appointments: +${apptsNew}${verb}`);
  console.log(`✔ payments: +${paymentsNew}${verb}`);
  if (skipped > 0) console.log(`  skipped: ${skipped}`);
  await prisma.$disconnect();
  console.log(APPLY ? "\nDone." : "\nDry run: nothing written.");
}

/**
 * First planned slot inside the doctor's schedule that overlaps none of the
 * doctor's existing visits (cancelled ones free their slot) and none of the
 * doctor's time off.
 */
async function firstFreeSlot(
  doctor: Doctor,
  args: { kind: "past" | "future"; durationMin: number; now: Date; seed: number },
): Promise<PlannedSlot | null> {
  const candidates = candidateSlots({
    kind: args.kind,
    schedules: doctor.schedules,
    durationMin: args.durationMin,
    now: args.now,
    seed: args.seed,
  });
  if (candidates.length === 0) return null;
  const from = new Date(Math.min(...candidates.map((c) => c.date.getTime())));
  const to = new Date(Math.max(...candidates.map((c) => c.endDate.getTime())));
  const [visits, timeOff] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        status: { notIn: ["CANCELLED"] },
        date: { lt: to },
        endDate: { gt: from },
      },
      select: { date: true, endDate: true },
    }),
    prisma.doctorTimeOff.findMany({
      where: { doctorId: doctor.id, startAt: { lt: to }, endAt: { gt: from } },
      select: { startAt: true, endAt: true },
    }),
  ]);
  const busy = [
    ...visits,
    ...timeOff.map((t) => ({ date: t.startAt, endDate: t.endAt })),
  ];
  return (
    candidates.find(
      (c) =>
        !busy.some((b) => c.date < b.endDate && c.endDate > b.date),
    ) ?? null
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
