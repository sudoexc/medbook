/**
 * Total stress seed for `neurofax` clinic.
 *
 * Bulk-creates varied scenarios: doctors with full-week schedules, cabinets,
 * services, ~30 patients across segments / languages / channels, ~150
 * appointments across past 30d / today / next 7d in every status, payments
 * for completed visits with mixed methods + statuses.
 *
 * Idempotent: tagged with "STRESS-" prefix on names/codes/phones; re-running
 * upserts instead of duplicating.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const TAG = "STRESS";

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length]!;
}
function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const clinic = await prisma.clinic.findUnique({ where: { slug: "neurofax" } });
  if (!clinic) throw new Error("neurofax clinic missing — run base seed first");
  const clinicId = clinic.id;

  console.log("=== TOTAL-STRESS-SEED ===");
  console.log(`Clinic: ${clinic.nameRu} (${clinicId})`);

  // ── Cabinets ────────────────────────────────────────────────────────────
  const cabinetSpecs = [
    { number: `${TAG}-201`, floor: 2, nameRu: "Тестовый кабинет 1" },
    { number: `${TAG}-202`, floor: 2, nameRu: "Тестовый кабинет 2" },
    { number: `${TAG}-203`, floor: 3, nameRu: "Тестовый кабинет 3" },
  ];
  const cabinets = [];
  for (const c of cabinetSpecs) {
    const cab = await prisma.cabinet.upsert({
      where: { clinicId_number: { clinicId, number: c.number } },
      update: { floor: c.floor, nameRu: c.nameRu, isActive: true },
      create: { clinicId, ...c, equipment: ["МРТ", "ЭКГ"] },
    });
    cabinets.push(cab);
  }
  console.log(`✓ cabinets: ${cabinets.length}`);

  // ── Services ────────────────────────────────────────────────────────────
  const serviceSpecs = [
    { code: `${TAG}-CONSULT`, nameRu: "Консультация невролога", nameUz: "Nevrolog konsultatsiyasi", durationMin: 30, priceBase: 200_000 },
    { code: `${TAG}-MRI`, nameRu: "МРТ головного мозга", nameUz: "Bosh miya MRT", durationMin: 45, priceBase: 800_000 },
    { code: `${TAG}-EEG`, nameRu: "ЭЭГ исследование", nameUz: "EEG tekshiruvi", durationMin: 60, priceBase: 350_000 },
    { code: `${TAG}-FOLLOW`, nameRu: "Повторный приём", nameUz: "Takroriy qabul", durationMin: 20, priceBase: 150_000 },
    { code: `${TAG}-URGENT`, nameRu: "Срочный приём (urgent)", nameUz: "Shoshilinch qabul", durationMin: 30, priceBase: 400_000 },
  ];
  const services = [];
  for (const s of serviceSpecs) {
    const sv = await prisma.service.upsert({
      where: { clinicId_code: { clinicId, code: s.code } },
      update: { nameRu: s.nameRu, nameUz: s.nameUz, durationMin: s.durationMin, priceBase: s.priceBase, isActive: true },
      create: { clinicId, ...s, category: "Неврология" },
    });
    services.push(sv);
  }
  console.log(`✓ services: ${services.length}`);

  // ── Doctors with full-week schedules ────────────────────────────────────
  const doctorSpecs = [
    { slug: `${TAG}-neuro`, nameRu: "Тестов Невролог Стрессович", nameUz: "Testov Nevrolog Stressovich", specRu: "Невролог", specUz: "Nevropatolog", color: "#3DD5C0", cabinet: cabinets[0]! },
    { slug: `${TAG}-cardio`, nameRu: "Тестова Кардиолог Стрессовна", nameUz: "Testova Kardiolog Stressovna", specRu: "Кардиолог", specUz: "Kardiolog", color: "#F59E0B", cabinet: cabinets[1]! },
    { slug: `${TAG}-pediatr`, nameRu: "Тестова Педиатр Стрессовна", nameUz: "Testova Pediatr Stressovna", specRu: "Педиатр", specUz: "Pediatr", color: "#A855F7", cabinet: cabinets[2]! },
  ];
  const doctors = [];
  for (const d of doctorSpecs) {
    const doc = await prisma.doctor.upsert({
      where: { clinicId_slug: { clinicId, slug: d.slug } },
      update: { nameRu: d.nameRu, nameUz: d.nameUz, specializationRu: d.specRu, specializationUz: d.specUz, color: d.color, cabinetId: d.cabinet.id, isActive: true, salaryPercent: 40, pricePerVisit: 200_000 },
      create: { clinicId, slug: d.slug, nameRu: d.nameRu, nameUz: d.nameUz, specializationRu: d.specRu, specializationUz: d.specUz, color: d.color, cabinetId: d.cabinet.id, salaryPercent: 40, pricePerVisit: 200_000 },
    });
    doctors.push(doc);

    // Wipe + recreate schedules so we can guarantee Mon-Sun coverage.
    await prisma.doctorSchedule.deleteMany({ where: { doctorId: doc.id } });
    for (let weekday = 0; weekday < 7; weekday++) {
      await prisma.doctorSchedule.create({
        data: { clinicId, doctorId: doc.id, weekday, startTime: "09:00", endTime: "18:00", isActive: true },
      });
    }

    // Link all services to this doctor
    for (const sv of services) {
      await prisma.serviceOnDoctor.upsert({
        where: { doctorId_serviceId: { doctorId: doc.id, serviceId: sv.id } },
        update: {},
        create: { doctorId: doc.id, serviceId: sv.id },
      });
    }
  }
  console.log(`✓ doctors: ${doctors.length} (each Mon-Sun 09:00-18:00, all services linked)`);

  // ── Patients (30, varied segments / langs / channels) ───────────────────
  const segments = ["NEW", "ACTIVE", "DORMANT", "VIP", "CHURN"] as const;
  const langs = ["RU", "UZ"] as const;
  const genders = ["MALE", "FEMALE"] as const;
  const channels = ["TG", "SMS", "CALL", "EMAIL", "VISIT"] as const;

  const patientNames = [
    "Алиев Бахтиёр Каримович", "Каримова Мадина Алишеровна", "Расулов Тимур Исматович",
    "Юсупова Зарина Бахромовна", "Ким Александр Викторович", "Иванов Сергей Петрович",
    "Сидорова Анна Михайловна", "Ахмедов Диёр Шавкатович", "Холматова Шахзода Алишеровна",
    "Усманов Жасур Эркинович", "Ражабова Дилноза Ильхомовна", "Назаров Бекзод Толибжонович",
    "Эргашева Гулнора Махсумовна", "Турсунов Аброр Рустамович", "Маликова Нилуфар Тимуровна",
    "Pasha (VIP)", "Зокиров Шерзод Иномович", "Махмудова Камила Рустамовна",
    "Сатторов Жахонгир Дилмуродович", "Хасанова Ёкинай Анваровна", "Юлдашев Сардор Гайратович",
    "Ниёзова Гулсара Кахрамоновна", "Норматов Озодбек Шавкатович", "Каюмова Феруза Юсуповна",
    "Олимов Дилшод Эркинович", "Эшонова Робия Тимуровна", "Дусматов Хасан Олимжонович",
    "Кадирова Шахноза Самадовна", "Жураев Бахром Алишерович", "Султанова Дилфуза Содиковна",
  ];

  const patients = [];
  for (let i = 0; i < patientNames.length; i++) {
    const phone = `+99890${String(7000000 + i).padStart(7, "0")}`;
    const phoneNormalized = phone.replace(/\D/g, "");
    const seg = segments[i % segments.length]!;
    const visitsCount = seg === "VIP" ? rand(20, 50) : seg === "ACTIVE" ? rand(3, 10) : seg === "NEW" ? 0 : rand(1, 5);
    const ltv = visitsCount * rand(150_000, 500_000);
    const discount = seg === "VIP" ? 15 : i % 7 === 0 ? 10 : 0;

    const p = await prisma.patient.upsert({
      where: { clinicId_phoneNormalized: { clinicId, phoneNormalized } },
      update: {
        fullName: `${TAG} ${patientNames[i]!}`,
        segment: seg,
        preferredLang: langs[i % langs.length]!,
        gender: genders[i % genders.length]!,
        preferredChannel: channels[i % channels.length]!,
        visitsCount,
        ltv,
        discountPct: discount,
        consentMarketing: i % 3 !== 0,
        notes: i % 5 === 0 ? "Аллергия на пенициллин" : null,
        tags: i % 4 === 0 ? ["хроник", "регулярный"] : i % 4 === 1 ? ["VIP"] : [],
        birthDate: new Date(1960 + (i * 17) % 50, i % 12, 1 + (i * 3) % 28),
      },
      create: {
        clinicId,
        fullName: `${TAG} ${patientNames[i]!}`,
        phone,
        phoneNormalized,
        segment: seg,
        preferredLang: langs[i % langs.length]!,
        gender: genders[i % genders.length]!,
        preferredChannel: channels[i % channels.length]!,
        visitsCount,
        ltv,
        discountPct: discount,
        consentMarketing: i % 3 !== 0,
        notes: i % 5 === 0 ? "Аллергия на пенициллин" : null,
        tags: i % 4 === 0 ? ["хроник", "регулярный"] : i % 4 === 1 ? ["VIP"] : [],
        birthDate: new Date(1960 + (i * 17) % 50, i % 12, 1 + (i * 3) % 28),
      } as never,
    });
    patients.push(p);
  }
  console.log(`✓ patients: ${patients.length} (segments: ${segments.join("/")})`);

  // ── Wipe prior STRESS-tagged appointments + payments to keep idempotency
  const oldAppts = await prisma.appointment.findMany({
    where: { clinicId, comments: { startsWith: `${TAG}:` } },
    select: { id: true },
  });
  if (oldAppts.length > 0) {
    const ids = oldAppts.map((a) => a.id);
    await prisma.payment.deleteMany({ where: { appointmentId: { in: ids } } });
    await prisma.appointmentService.deleteMany({ where: { appointmentId: { in: ids } } });
    await prisma.appointment.deleteMany({ where: { id: { in: ids } } });
    console.log(`✓ cleared ${oldAppts.length} prior STRESS appointments`);
  }

  // ── Appointments: past 30d completed, today's queue, future bookings ───
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);

  const channelTypes = ["WALKIN", "PHONE", "TELEGRAM", "WEBSITE", "KIOSK"] as const;
  const apptStats: Record<string, number> = {};
  const todayStartHourMs = today.getTime() + 9 * 3600_000;
  let appointmentsCreated = 0;
  let paymentsCreated = 0;

  // PAST: 30 days back, mostly COMPLETED, some CANCELLED, some NO_SHOW
  for (let dayOffset = 30; dayOffset >= 1; dayOffset--) {
    const day = new Date(today.getTime() - dayOffset * 86400_000);
    const apptCount = rand(2, 5);
    for (let k = 0; k < apptCount; k++) {
      const doc = pick(doctors, k);
      const sv = pick(services, dayOffset + k);
      const p = pick(patients, dayOffset * 3 + k);
      const startHour = 9 + (k * 2) % 9;
      const date = new Date(day);
      date.setHours(startHour, 0, 0, 0);
      const endDate = new Date(date.getTime() + sv.durationMin * 60_000);

      const status = (() => {
        const r = (dayOffset + k) % 10;
        if (r < 7) return "COMPLETED";
        if (r === 7) return "CANCELLED";
        if (r === 8) return "NO_SHOW";
        return "SKIPPED";
      })() as "COMPLETED" | "CANCELLED" | "NO_SHOW" | "SKIPPED";

      const discountPct = p.discountPct;
      const discountAmount = (sv.priceBase * discountPct) / 100;
      const priceFinal = sv.priceBase - discountAmount;

      const appt = await prisma.appointment.create({
        data: {
          clinicId,
          patientId: p.id,
          doctorId: doc.id,
          cabinetId: doc.cabinetId,
          serviceId: sv.id,
          date,
          time: `${String(startHour).padStart(2, "0")}:00`,
          durationMin: sv.durationMin,
          endDate,
          status,
          queueStatus: status,
          channel: pick(channelTypes, dayOffset + k),
          priceBase: sv.priceBase,
          priceService: sv.priceBase,
          discountPct,
          discountAmount,
          priceFinal,
          comments: `${TAG}:past:${dayOffset}d`,
          startedAt: status === "COMPLETED" ? date : null,
          completedAt: status === "COMPLETED" ? endDate : null,
          cancelledAt: status === "CANCELLED" ? new Date(date.getTime() - 3600_000) : null,
          cancelReason: status === "CANCELLED" ? "Patient called to cancel" : null,
        },
      });
      appointmentsCreated++;
      apptStats[status] = (apptStats[status] ?? 0) + 1;

      // Payment for completed visits (mostly PAID, some PARTIAL)
      if (status === "COMPLETED") {
        const methods = ["CASH", "CARD", "PAYME", "CLICK", "TRANSFER"] as const;
        const isPartial = (dayOffset + k) % 11 === 0;
        const paid = isPartial ? Math.round(priceFinal * 0.5) : priceFinal;
        await prisma.payment.create({
          data: {
            clinicId,
            appointmentId: appt.id,
            patientId: p.id,
            amount: paid,
            currency: "UZS",
            method: pick(methods, dayOffset + k),
            status: isPartial ? "PARTIAL" : "PAID",
            paidAt: endDate,
          },
        });
        paymentsCreated++;
      }
    }
  }

  // TODAY: queue mix — BOOKED / WAITING / IN_PROGRESS / COMPLETED
  const todayCount = 18;
  for (let k = 0; k < todayCount; k++) {
    const doc = pick(doctors, k);
    const sv = pick(services, k);
    const p = pick(patients, k * 5);
    const minutesFromMorning = k * 30;
    const date = new Date(todayStartHourMs + minutesFromMorning * 60_000);
    const endDate = new Date(date.getTime() + sv.durationMin * 60_000);

    const r = k % 6;
    const status = (r === 0 ? "COMPLETED" : r === 1 ? "IN_PROGRESS" : r === 2 ? "WAITING" : "BOOKED") as "COMPLETED" | "IN_PROGRESS" | "WAITING" | "BOOKED";

    const discountPct = p.discountPct;
    const discountAmount = (sv.priceBase * discountPct) / 100;
    const priceFinal = sv.priceBase - discountAmount;

    const appt = await prisma.appointment.create({
      data: {
        clinicId,
        patientId: p.id,
        doctorId: doc.id,
        cabinetId: doc.cabinetId,
        serviceId: sv.id,
        date,
        time: date.toTimeString().slice(0, 5),
        durationMin: sv.durationMin,
        endDate,
        status,
        queueStatus: status,
        queueOrder: k + 1,
        channel: pick(channelTypes, k),
        priceBase: sv.priceBase,
        priceService: sv.priceBase,
        discountPct,
        discountAmount,
        priceFinal,
        comments: `${TAG}:today`,
        calledAt: ["WAITING", "IN_PROGRESS", "COMPLETED"].includes(status) ? date : null,
        startedAt: ["IN_PROGRESS", "COMPLETED"].includes(status) ? date : null,
        completedAt: status === "COMPLETED" ? endDate : null,
      },
    });
    appointmentsCreated++;
    apptStats[status] = (apptStats[status] ?? 0) + 1;

    if (status === "COMPLETED") {
      await prisma.payment.create({
        data: {
          clinicId,
          appointmentId: appt.id,
          patientId: p.id,
          amount: priceFinal,
          currency: "UZS",
          method: "CASH",
          status: "PAID",
          paidAt: endDate,
        },
      });
      paymentsCreated++;
    }
  }

  // FUTURE: next 7 days, all BOOKED
  for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
    const day = new Date(today.getTime() + dayOffset * 86400_000);
    const apptCount = rand(2, 6);
    for (let k = 0; k < apptCount; k++) {
      const doc = pick(doctors, k);
      const sv = pick(services, dayOffset + k);
      const p = pick(patients, (dayOffset * 7 + k) % patients.length);
      const startHour = 10 + (k * 2) % 7;
      const date = new Date(day);
      date.setHours(startHour, 30, 0, 0);
      const endDate = new Date(date.getTime() + sv.durationMin * 60_000);

      await prisma.appointment.create({
        data: {
          clinicId,
          patientId: p.id,
          doctorId: doc.id,
          cabinetId: doc.cabinetId,
          serviceId: sv.id,
          date,
          time: `${String(startHour).padStart(2, "0")}:30`,
          durationMin: sv.durationMin,
          endDate,
          status: "BOOKED",
          queueStatus: "BOOKED",
          channel: pick(channelTypes, dayOffset + k),
          priceBase: sv.priceBase,
          priceService: sv.priceBase,
          discountPct: 0,
          discountAmount: 0,
          priceFinal: sv.priceBase,
          comments: `${TAG}:future:+${dayOffset}d`,
        },
      });
      appointmentsCreated++;
      apptStats["BOOKED_FUTURE"] = (apptStats["BOOKED_FUTURE"] ?? 0) + 1;
    }
  }

  console.log(`✓ appointments: ${appointmentsCreated}`);
  console.log(`  by status:`, apptStats);
  console.log(`✓ payments: ${paymentsCreated}`);

  console.log("\n=== SEED DONE ===");
}

main()
  .catch((e) => { console.error("FATAL:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
