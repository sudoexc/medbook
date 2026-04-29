/**
 * scripts/seed-neurofax-real.ts — overwrites the neurofax clinic catalog
 * (cabinets, services, doctors, schedules, ServiceOnDoctor) with the real
 * production line-up: 5 cabinets (1, 2, 4, 5, 6 — №3 intentionally absent),
 * 7 doctors anchored to a fixed cabinet, 13 services with per-doctor
 * priceOverrides where applicable.
 *
 * Idempotent. Existing demo doctors/cabinets/services are flipped to
 * isActive=false (referential integrity is preserved — past appointments
 * still resolve), then the canonical set is upserted on top.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "",
  }),
});

const SLUG = "neurofax";

// ─── Cabinets ────────────────────────────────────────────────────────
const CABINETS = [
  { number: "1", floor: 1, nameRu: "Взрослый невролог", nameUz: "Katta nevrolog" },
  { number: "2", floor: 1, nameRu: "Кардиология", nameUz: "Kardiologiya" },
  { number: "4", floor: 1, nameRu: "УЗИ и диагностика", nameUz: "UZI va diagnostika" },
  { number: "5", floor: 1, nameRu: "Взрослый невролог", nameUz: "Katta nevrolog" },
  { number: "6", floor: 1, nameRu: "Детский невролог / педиатр", nameUz: "Bolalar nevrologi / pediatr" },
] as const;

// ─── Services (prices stored in тийины: сум × 100) ──────────────────
const SUM = (uzs: number) => uzs * 100;

const SERVICES = [
  // Консультации (один code на специализацию для гибких прайсов)
  { code: "KONS_NEURO_ADULT", nameRu: "Консультация невролога (взрослый)", nameUz: "Nevrolog konsultatsiyasi (katta)", durationMin: 30, priceBase: SUM(200_000), category: "Консультация" },
  { code: "KONS_KARDIO", nameRu: "Консультация кардиолога", nameUz: "Kardiolog konsultatsiyasi", durationMin: 30, priceBase: SUM(200_000), category: "Консультация" },
  { code: "KONS_PED_NEURO", nameRu: "Консультация детского невролога / педиатра", nameUz: "Bolalar nevrologi / pediatr konsultatsiyasi", durationMin: 30, priceBase: SUM(200_000), category: "Консультация" },

  // ЭЭГ family
  { code: "EEG", nameRu: "ЭЭГ", nameUz: "EEG", durationMin: 30, priceBase: SUM(100_000), category: "Диагностика" },
  { code: "EEG_30", nameRu: "ЭЭГ (30 мин)", nameUz: "EEG (30 daq)", durationMin: 30, priceBase: SUM(150_000), category: "Диагностика" },
  { code: "EEG_60", nameRu: "ЭЭГ (1 час)", nameUz: "EEG (1 soat)", durationMin: 60, priceBase: SUM(250_000), category: "Диагностика" },

  // Other neuro diagnostics
  { code: "REO_EG", nameRu: "РеоЭГ", nameUz: "ReoEG", durationMin: 30, priceBase: SUM(60_000), category: "Диагностика" },
  { code: "EHO_EG", nameRu: "ЭхоЭГ", nameUz: "ExoEG", durationMin: 30, priceBase: SUM(40_000), category: "Диагностика" },

  // Cardio
  { code: "EKG", nameRu: "ЭКГ", nameUz: "EKG", durationMin: 20, priceBase: SUM(70_000), category: "Диагностика" },
  { code: "DOPPLER_BCA", nameRu: "Допплер БЦА", nameUz: "Doppler BCA", durationMin: 30, priceBase: SUM(150_000), category: "УЗИ" },
  { code: "EHO_KG", nameRu: "ЭхоКГ", nameUz: "ExoKG", durationMin: 30, priceBase: SUM(150_000), category: "УЗИ" },

  // UZI
  { code: "UZI_ORGAN", nameRu: "УЗИ (1 орган)", nameUz: "UZI (1 organ)", durationMin: 25, priceBase: SUM(80_000), category: "УЗИ" },
  { code: "NSG", nameRu: "НСГ (нейросонография)", nameUz: "NSG (neyrosonografiya)", durationMin: 25, priceBase: SUM(80_000), category: "УЗИ" },
] as const;

type ServiceCode = (typeof SERVICES)[number]["code"];

// ─── Doctors ─────────────────────────────────────────────────────────
type DoctorSpec = {
  slug: string;
  nameRu: string;
  nameUz: string;
  specializationRu: string;
  specializationUz: string;
  email: string;
  color: string;
  cabinetNumber: string;
  // weekday: 0=Sun, 1=Mon, ..., 6=Sat
  schedule: { weekday: number; start: string; end: string }[];
  services: { code: ServiceCode; priceOverride?: number }[];
};

const DOCTORS: DoctorSpec[] = [
  {
    slug: "busakov-bahtiyar",
    nameRu: "Бусаков Бахтияр Султанович",
    nameUz: "Busakov Baxtiyor Sultonovich",
    specializationRu: "Невролог (взрослый)",
    specializationUz: "Nevrolog (katta)",
    email: "busakov@neurofax.uz",
    color: "#3DD5C0",
    cabinetNumber: "1",
    schedule: [
      { weekday: 1, start: "08:00", end: "17:00" },
      { weekday: 2, start: "08:00", end: "17:00" },
      { weekday: 3, start: "08:00", end: "17:00" },
      { weekday: 4, start: "08:00", end: "17:00" },
      { weekday: 5, start: "08:00", end: "17:00" },
      { weekday: 6, start: "08:00", end: "17:00" },
    ],
    services: [
      { code: "KONS_NEURO_ADULT", priceOverride: SUM(250_000) },
      { code: "EEG" },
      { code: "REO_EG" },
      { code: "EHO_EG" },
    ],
  },
  {
    slug: "tyncherova-naylya",
    nameRu: "Тынчерова Найля Юсуфовна",
    nameUz: "Tinchorova Nailya Yusufovna",
    specializationRu: "Кардиолог",
    specializationUz: "Kardiolog",
    email: "tyncherova@neurofax.uz",
    color: "#F59E0B",
    cabinetNumber: "2",
    schedule: [
      { weekday: 1, start: "09:00", end: "15:00" },
      { weekday: 3, start: "09:00", end: "15:00" },
      { weekday: 5, start: "09:00", end: "15:00" },
      { weekday: 6, start: "09:00", end: "15:00" },
    ],
    services: [
      { code: "KONS_KARDIO" },
      { code: "EKG" },
    ],
  },
  {
    slug: "muhitdinova-shahnoza",
    nameRu: "Мухитдинова Шахноза Салахитдиновна",
    nameUz: "Muxitdinova Shaxnoza Salohiddinovna",
    specializationRu: "Кардиолог",
    specializationUz: "Kardiolog",
    email: "muhitdinova@neurofax.uz",
    color: "#EF4444",
    cabinetNumber: "2",
    schedule: [
      { weekday: 2, start: "09:30", end: "15:00" },
      { weekday: 4, start: "09:30", end: "15:00" },
    ],
    services: [
      { code: "KONS_KARDIO" },
      { code: "DOPPLER_BCA" },
      { code: "EHO_KG" },
      { code: "EKG" },
    ],
  },
  {
    slug: "rahmanova-nigora",
    nameRu: "Рахманова Нигора Бахтияровна",
    nameUz: "Raxmonova Nigora Baxtiyorovna",
    specializationRu: "УЗИ-диагност",
    specializationUz: "UZI diagnost",
    email: "rahmanova@neurofax.uz",
    color: "#A855F7",
    cabinetNumber: "4",
    schedule: [
      { weekday: 1, start: "10:00", end: "14:00" },
      { weekday: 2, start: "10:00", end: "14:00" },
      { weekday: 3, start: "10:00", end: "14:00" },
      { weekday: 4, start: "10:00", end: "14:00" },
      { weekday: 5, start: "10:00", end: "14:00" },
      { weekday: 6, start: "10:00", end: "14:00" },
    ],
    services: [
      { code: "UZI_ORGAN" },
      { code: "NSG" },
      { code: "EEG_30" },
      { code: "EEG_60" },
    ],
  },
  {
    slug: "sultanov-aziz",
    nameRu: "Султанов Азиз Бахтиёр угли",
    nameUz: "Sultonov Aziz Baxtiyor o‘g‘li",
    specializationRu: "Невролог (взрослый)",
    specializationUz: "Nevrolog (katta)",
    email: "sultanov@neurofax.uz",
    color: "#10B981",
    cabinetNumber: "5",
    schedule: [
      { weekday: 1, start: "08:00", end: "17:00" },
      { weekday: 2, start: "08:00", end: "17:00" },
      { weekday: 3, start: "08:00", end: "17:00" },
      { weekday: 4, start: "08:00", end: "17:00" },
      { weekday: 5, start: "08:00", end: "17:00" },
      { weekday: 6, start: "08:00", end: "17:00" },
    ],
    services: [
      { code: "KONS_NEURO_ADULT" },
      { code: "EEG" },
      { code: "REO_EG" },
      { code: "EHO_EG" },
    ],
  },
  {
    slug: "israilova-feruza",
    nameRu: "Исраилова Феруза Камиловна",
    nameUz: "Isroilova Feruza Komilovna",
    specializationRu: "Детский невролог / педиатр",
    specializationUz: "Bolalar nevrologi / pediatr",
    email: "israilova@neurofax.uz",
    color: "#3B82F6",
    cabinetNumber: "6",
    schedule: [
      { weekday: 2, start: "09:00", end: "15:00" },
      { weekday: 4, start: "09:00", end: "15:00" },
      { weekday: 6, start: "09:00", end: "15:00" },
    ],
    services: [{ code: "KONS_PED_NEURO" }],
  },
  {
    slug: "vazirova-yulduz",
    nameRu: "Вазирова Юлдуз Нурматова",
    nameUz: "Vazirova Yulduz Nurmatova",
    specializationRu: "Детский невролог / педиатр",
    specializationUz: "Bolalar nevrologi / pediatr",
    email: "vazirova@neurofax.uz",
    color: "#EC4899",
    cabinetNumber: "6",
    schedule: [
      { weekday: 1, start: "09:00", end: "15:00" },
      { weekday: 3, start: "09:00", end: "15:00" },
      { weekday: 5, start: "09:00", end: "15:00" },
    ],
    services: [{ code: "KONS_PED_NEURO" }],
  },
];

async function main() {
  const clinic = await prisma.clinic.findUnique({
    where: { slug: SLUG },
    select: { id: true, nameRu: true },
  });
  if (!clinic) {
    throw new Error(
      `Clinic ${SLUG} not found — run prisma/seed.ts first to bootstrap the platform.`,
    );
  }

  const doctorPassHash = await bcrypt.hash("doctor", 10);

  // ── Cabinets: deactivate all, upsert real, capture ids ────────
  await prisma.cabinet.updateMany({
    where: { clinicId: clinic.id },
    data: { isActive: false },
  });
  const cabIds = new Map<string, string>();
  for (const c of CABINETS) {
    const cab = await prisma.cabinet.upsert({
      where: { clinicId_number: { clinicId: clinic.id, number: c.number } },
      update: {
        floor: c.floor,
        nameRu: c.nameRu,
        nameUz: c.nameUz,
        isActive: true,
        equipment: [],
      },
      create: {
        clinicId: clinic.id,
        number: c.number,
        floor: c.floor,
        nameRu: c.nameRu,
        nameUz: c.nameUz,
        isActive: true,
        equipment: [],
      },
    });
    cabIds.set(c.number, cab.id);
  }

  // ── Services: deactivate all, upsert real catalog, capture ids ────
  await prisma.service.updateMany({
    where: { clinicId: clinic.id },
    data: { isActive: false },
  });
  const svcIds = new Map<string, string>();
  for (const s of SERVICES) {
    const svc = await prisma.service.upsert({
      where: { clinicId_code: { clinicId: clinic.id, code: s.code } },
      update: {
        nameRu: s.nameRu,
        nameUz: s.nameUz,
        durationMin: s.durationMin,
        priceBase: s.priceBase,
        category: s.category,
        isActive: true,
      },
      create: {
        clinicId: clinic.id,
        code: s.code,
        nameRu: s.nameRu,
        nameUz: s.nameUz,
        durationMin: s.durationMin,
        priceBase: s.priceBase,
        category: s.category,
        isActive: true,
      },
    });
    svcIds.set(s.code, svc.id);
  }

  // ── Doctors: deactivate everyone, upsert real lineup ────────────
  await prisma.doctor.updateMany({
    where: { clinicId: clinic.id },
    data: { isActive: false },
  });

  for (const d of DOCTORS) {
    const cabId = cabIds.get(d.cabinetNumber);
    if (!cabId) {
      throw new Error(`cabinet №${d.cabinetNumber} missing for ${d.slug}`);
    }

    // User account (login)
    const user = await prisma.user.upsert({
      where: { email: d.email },
      update: {
        name: d.nameRu,
        role: "DOCTOR",
        clinicId: clinic.id,
        active: true,
        passwordHash: doctorPassHash,
      },
      create: {
        email: d.email,
        name: d.nameRu,
        role: "DOCTOR",
        clinicId: clinic.id,
        passwordHash: doctorPassHash,
      },
    });

    const doctor = await prisma.doctor.upsert({
      where: { clinicId_slug: { clinicId: clinic.id, slug: d.slug } },
      update: {
        nameRu: d.nameRu,
        nameUz: d.nameUz,
        specializationRu: d.specializationRu,
        specializationUz: d.specializationUz,
        color: d.color,
        userId: user.id,
        isActive: true,
      },
      create: {
        clinicId: clinic.id,
        slug: d.slug,
        nameRu: d.nameRu,
        nameUz: d.nameUz,
        specializationRu: d.specializationRu,
        specializationUz: d.specializationUz,
        color: d.color,
        userId: user.id,
        isActive: true,
      },
    });

    // Replace ServiceOnDoctor links with the doctor's actual catalogue.
    await prisma.serviceOnDoctor.deleteMany({ where: { doctorId: doctor.id } });
    for (const sv of d.services) {
      const sid = svcIds.get(sv.code);
      if (!sid) throw new Error(`service ${sv.code} missing`);
      await prisma.serviceOnDoctor.create({
        data: {
          doctorId: doctor.id,
          serviceId: sid,
          priceOverride: sv.priceOverride ?? null,
        },
      });
    }

    // Replace DoctorSchedule with real weekly grid + cabinet anchor.
    await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
    for (const sch of d.schedule) {
      await prisma.doctorSchedule.create({
        data: {
          clinicId: clinic.id,
          doctorId: doctor.id,
          weekday: sch.weekday,
          startTime: sch.start,
          endTime: sch.end,
          cabinetId: cabId,
          isActive: true,
        },
      });
    }
  }

  console.log("");
  console.log("✅ neurofax-real seeded");
  console.log(`  cabinets   ${CABINETS.length} active (1, 2, 4, 5, 6)`);
  console.log(`  services   ${SERVICES.length} active`);
  console.log(`  doctors    ${DOCTORS.length} anchored to fixed cabinets`);
  console.log("");
  console.log("  cabinet 1 → Бусаков Б.С.            (Пн–Сб 08:00–17:00)");
  console.log("  cabinet 2 → Тынчерова Н.Ю.          (Пн/Ср/Пт/Сб 09:00–15:00)");
  console.log("            + Мухитдинова Ш.С.        (Вт/Чт 09:30–15:00)");
  console.log("  cabinet 4 → Рахманова Н.Б.          (Пн–Сб 10:00–14:00)");
  console.log("  cabinet 5 → Султанов А.Б.           (Пн–Сб 08:00–17:00)");
  console.log("  cabinet 6 → Исраилова Ф.К.          (Вт/Чт/Сб 09:00–15:00)");
  console.log("            + Вазирова Ю.Н.           (Пн/Ср/Пт 09:00–15:00)");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
