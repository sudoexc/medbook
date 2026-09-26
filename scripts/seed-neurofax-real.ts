/**
 * scripts/seed-neurofax-real.ts — the NeuroFax clinic catalog as launched:
 * 5 cabinets (1, 2, 4, 5, 6 — №3 intentionally absent, 2-Б and 6-Б are
 * scheduling siblings), 7 doctors anchored to a fixed cabinet, 13 services
 * with per-doctor priceOverrides from the 18.05.2026 price list.
 *
 * Audit G2-08: it used to deactivate every cabinet, service and doctor of the
 * clinic, re-upsert this line-up with the 18.05 prices and grids and set
 * `active: true` on every doctor's login, without a transaction. On the live
 * clinic that reverted the admin's prices and schedules, hid doctors and
 * services added since, let a dismissed doctor sign in again, and a unique
 * cabinet clash halfway left the clinic with no active doctor.
 *
 * Now (plan in scripts/_catalog-plan.ts):
 *   - DRY RUN by default: prints what it would do. APPLY=1 writes.
 *   - Strictly additive by default: creates only what is missing. Existing
 *     cabinets, services and doctors keep their prices, schedules, links,
 *     names and isActive. A login's `active` flag is never touched.
 *   - «Missing» on purpose stays missing: a doctor the admin purged (or whose
 *     login is left without a doctor profile) and a service whose code the
 *     admin changed are skipped, read from the audit trail and the logins.
 *   - Everything else is an explicit flag:
 *       --reactivate             canonical rows that exist but are inactive
 *                                (never the login: re-enable that in the UI)
 *       --recreate-removed       canonical doctors and services the admin
 *                                removed in the CRM (never the login either)
 *       --deactivate-others      rows of the clinic not in this line-up
 *       --reset-prices           Service.priceBase and priceOverride
 *       --reset-schedules        weekly grids of the canonical doctors
 *       --reset-doctor-services  service links of the canonical doctors
 *   - All writes run in ONE transaction: a failure changes nothing.
 *
 *   docker compose exec -T worker npx tsx scripts/seed-neurofax-real.ts
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/seed-neurofax-real.ts
 *
 * Doctor logins (audit SEC-04): a doctor account that does not exist yet is
 * created with a random password (or SEED_PASSWORD), printed once at the end,
 * and must be changed at first sign-in. An existing account's password is
 * never touched. Creating an account with NODE_ENV=production needs
 * SEED_ALLOW_PROD_ACCOUNTS=1.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  CATALOG_AUDIT_ACTIONS,
  CATALOG_FLAG_NAMES,
  parseCatalogFlags,
  planCatalog,
  removalsFromAudit,
  renamedServiceCodes,
  writesOf,
  type CatalogOp,
  type ExistingCatalog,
} from "./_catalog-plan";
import {
  assertAccountSeedAllowed,
  printIssuedPasswords,
  seedPasswordFor,
  type SeedPassword,
} from "./_seed-passwords";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "",
  }),
});

const SLUG = "neurofax";

// ─── Cabinets ────────────────────────────────────────────────────────
// Phase 11: every doctor occupies their own cabinet (Doctor.cabinetId is
// NOT NULL UNIQUE), so the previous "two doctors share cabinet 2/6 on
// alternate shifts" model is gone. Cabinets 2-Б and 6-Б are siblings of
// 2 and 6 — same room conceptually, but separate scheduling units so each
// doctor has a stable home.
const CABINETS = [
  { number: "1", floor: 1, nameRu: "Взрослый невролог", nameUz: "Katta nevrolog" },
  { number: "2", floor: 1, nameRu: "Кардиология", nameUz: "Kardiologiya" },
  { number: "2-Б", floor: 1, nameRu: "Кардиология (доп.)", nameUz: "Kardiologiya (qo'sh.)" },
  { number: "4", floor: 1, nameRu: "УЗИ и диагностика", nameUz: "UZI va diagnostika" },
  { number: "5", floor: 1, nameRu: "Взрослый невролог", nameUz: "Katta nevrolog" },
  { number: "6", floor: 1, nameRu: "Детский невролог / педиатр", nameUz: "Bolalar nevrologi / pediatr" },
  { number: "6-Б", floor: 1, nameRu: "Детский невролог (доп.)", nameUz: "Bolalar nevrologi (qo'sh.)" },
] as const;

// ─── Services (prices stored in тийины: сум × 100) ──────────────────
const SUM = (uzs: number) => uzs * 100;

const SERVICES = [
  // Консультации (один code на специализацию для гибких прайсов)
  { code: "KONS_NEURO_ADULT", nameRu: "Консультация невролога (взрослый)", nameUz: "Nevrolog konsultatsiyasi (katta)", durationMin: 30, priceBase: SUM(200_000), category: "Консультация" },
  { code: "KONS_KARDIO", nameRu: "Консультация кардиолога", nameUz: "Kardiolog konsultatsiyasi", durationMin: 30, priceBase: SUM(200_000), category: "Консультация" },
  { code: "KONS_PED_NEURO", nameRu: "Консультация детского невролога / педиатра", nameUz: "Bolalar nevrologi / pediatr konsultatsiyasi", durationMin: 30, priceBase: SUM(200_000), category: "Консультация" },

  // ЭЭГ family — варианты и цены строго по прейскуранту клиники от 18.05.2026
  { code: "EEG", nameRu: "ЭЭГ", nameUz: "EEG", durationMin: 30, priceBase: SUM(150_000), category: "Диагностика" },
  { code: "EEG_30", nameRu: "ЭЭГ (сон и дети до 6 лет)", nameUz: "EEG (uyqu va 6 yoshgacha bolalar)", durationMin: 30, priceBase: SUM(200_000), category: "Диагностика" },
  { code: "EEG_60", nameRu: "ЭЭГ (сон 1 час)", nameUz: "EEG (uyqu 1 soat)", durationMin: 60, priceBase: SUM(300_000), category: "Диагностика" },

  // Other neuro diagnostics
  { code: "REO_EG", nameRu: "РеоЭГ", nameUz: "ReoEG", durationMin: 30, priceBase: SUM(100_000), category: "Диагностика" },
  { code: "EHO_EG", nameRu: "ЭхоЭГ", nameUz: "ExoEG", durationMin: 30, priceBase: SUM(50_000), category: "Диагностика" },

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
      // Кабинет 1 по прейскуранту от 18.05.2026 — 300 000 против базовых 200 000
      { code: "KONS_NEURO_ADULT", priceOverride: SUM(300_000) },
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
    cabinetNumber: "2-Б",
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
    cabinetNumber: "6-Б",
    schedule: [
      { weekday: 1, start: "09:00", end: "15:00" },
      { weekday: 3, start: "09:00", end: "15:00" },
      { weekday: 5, start: "09:00", end: "15:00" },
    ],
    services: [{ code: "KONS_PED_NEURO" }],
  },
];

const APPLY = process.env.APPLY === "1";
const FLAGS = parseCatalogFlags(process.argv.slice(2));

function describe(op: CatalogOp): string {
  switch (op.kind) {
    case "cabinet.create":
    case "cabinet.activate":
    case "cabinet.deactivate":
      return `${op.kind.padEnd(18)} №${op.number}`;
    case "service.create":
    case "service.activate":
    case "service.deactivate":
      return `${op.kind.padEnd(18)} ${op.code}`;
    case "service.price":
      return `${op.kind.padEnd(18)} ${op.code}: ${op.from / 100} → ${op.to / 100} сум`;
    case "doctor.create":
      return `${op.kind.padEnd(18)} ${op.slug}${op.userId ? " (existing login)" : " (new login)"}`;
    case "skip":
      return `${"skip".padEnd(18)} ${op.what}: ${op.reason}`;
    default:
      return `${op.kind.padEnd(18)} ${op.slug}`;
  }
}

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
  const clinicId = clinic.id;

  const [cabinets, services, doctors, users, auditRows] = await Promise.all([
    prisma.cabinet.findMany({
      where: { clinicId },
      select: { id: true, number: true, isActive: true },
    }),
    prisma.service.findMany({
      where: { clinicId },
      select: { id: true, code: true, isActive: true, priceBase: true },
    }),
    prisma.doctor.findMany({
      where: { clinicId },
      select: { id: true, slug: true, isActive: true, cabinetId: true, userId: true },
    }),
    prisma.user.findMany({
      where: { email: { in: DOCTORS.map((d) => d.email) } },
      select: { id: true, email: true, active: true },
    }),
    // Purged doctors and renamed service codes leave no row behind: the
    // audit trail is what remembers them (see removalsFromAudit).
    prisma.auditLog.findMany({
      where: { clinicId, action: { in: [...CATALOG_AUDIT_ACTIONS] } },
      select: { action: true, entityId: true, meta: true },
    }),
  ]);
  const existing: ExistingCatalog = {
    cabinets,
    services,
    doctors,
    users,
    removed: removalsFromAudit(auditRows),
  };
  const renamed = renamedServiceCodes(existing);
  const ops = planCatalog(
    {
      cabinets: [...CABINETS],
      services: [...SERVICES],
      doctors: DOCTORS,
    },
    existing,
    FLAGS,
  );
  const writes = writesOf(ops);
  const flagsOn = (Object.keys(FLAGS) as Array<keyof typeof FLAGS>)
    .filter((k) => FLAGS[k])
    .map((k) => CATALOG_FLAG_NAMES[k]);

  console.log(
    `seed-neurofax-real: ${APPLY ? "APPLY" : "DRY RUN (set APPLY=1 to write)"}` +
      `${flagsOn.length > 0 ? `, flags ${flagsOn.join(" ")}` : ", additive only"}\n`,
  );
  for (const op of ops) console.log(`  ${describe(op)}`);
  if (writes.length === 0) {
    console.log("\n✔ nothing to change");
    await prisma.$disconnect();
    return;
  }
  if (!APPLY) {
    console.log(`\n${writes.length} change(s) planned, nothing written.`);
    await prisma.$disconnect();
    return;
  }

  // Passwords are prepared before the transaction: bcrypt is slow, and a
  // new login must not be half-created.
  const newLogins = writes.filter(
    (o): o is Extract<CatalogOp, { kind: "doctor.create" }> =>
      o.kind === "doctor.create" && o.userId === null,
  );
  if (newLogins.length > 0) assertAccountSeedAllowed("scripts/seed-neurofax-real.ts");
  const passwords = new Map<string, SeedPassword>();
  for (const op of newLogins) {
    const spec = DOCTORS.find((d) => d.slug === op.slug)!;
    passwords.set(op.slug, await seedPasswordFor(spec.email));
  }

  await prisma.$transaction(
    async (tx) => {
      const cabinetId = async (number: string) => {
        const row = await tx.cabinet.findUnique({
          where: { clinicId_number: { clinicId, number } },
          select: { id: true },
        });
        if (!row) throw new Error(`cabinet №${number} missing`);
        return row.id;
      };
      const serviceId = async (code: string) => {
        const find = (c: string) =>
          tx.service.findUnique({
            where: { clinicId_code: { clinicId, code: c } },
            select: { id: true },
          });
        // A canonical service the admin renamed was skipped, not recreated:
        // the doctor's link goes to the renamed row.
        const alias = renamed.get(code);
        const row = (await find(code)) ?? (alias ? await find(alias) : null);
        if (!row) throw new Error(`service ${code} missing`);
        return row.id;
      };
      const specOf = (slug: string) => DOCTORS.find((d) => d.slug === slug)!;
      const writeLinks = async (doctorId: string, slug: string) => {
        await tx.serviceOnDoctor.deleteMany({ where: { doctorId } });
        for (const sv of specOf(slug).services) {
          await tx.serviceOnDoctor.create({
            data: {
              doctorId,
              serviceId: await serviceId(sv.code),
              priceOverride: sv.priceOverride ?? null,
            },
          });
        }
      };
      const writeSchedule = async (doctorId: string, slug: string) => {
        await tx.doctorSchedule.deleteMany({ where: { doctorId } });
        for (const sch of specOf(slug).schedule) {
          await tx.doctorSchedule.create({
            data: {
              clinicId,
              doctorId,
              weekday: sch.weekday,
              startTime: sch.start,
              endTime: sch.end,
              isActive: true,
            },
          });
        }
      };

      for (const op of writes) {
        switch (op.kind) {
          case "cabinet.create": {
            const c = CABINETS.find((x) => x.number === op.number)!;
            await tx.cabinet.create({
              data: {
                clinicId,
                number: c.number,
                floor: c.floor,
                nameRu: c.nameRu,
                nameUz: c.nameUz,
                isActive: true,
                equipment: [],
              },
            });
            break;
          }
          case "cabinet.activate":
          case "cabinet.deactivate":
            await tx.cabinet.update({
              where: { id: op.id },
              data: { isActive: op.kind === "cabinet.activate" },
            });
            break;
          case "service.create": {
            const sv = SERVICES.find((x) => x.code === op.code)!;
            await tx.service.create({
              data: {
                clinicId,
                code: sv.code,
                nameRu: sv.nameRu,
                nameUz: sv.nameUz,
                durationMin: sv.durationMin,
                priceBase: sv.priceBase,
                category: sv.category,
                isActive: true,
              },
            });
            break;
          }
          case "service.activate":
          case "service.deactivate":
            await tx.service.update({
              where: { id: op.id },
              data: { isActive: op.kind === "service.activate" },
            });
            break;
          case "service.price":
            await tx.service.update({ where: { id: op.id }, data: { priceBase: op.to } });
            break;
          case "doctor.create": {
            const d = specOf(op.slug);
            let userId = op.userId;
            if (!userId) {
              const pw = passwords.get(op.slug)!;
              const user = await tx.user.create({
                data: {
                  email: d.email,
                  name: d.nameRu,
                  role: "DOCTOR",
                  clinicId,
                  passwordHash: pw.hash,
                  mustChangePassword: pw.mustChangePassword,
                },
                select: { id: true },
              });
              userId = user.id;
            }
            const doctor = await tx.doctor.create({
              data: {
                clinicId,
                slug: d.slug,
                nameRu: d.nameRu,
                nameUz: d.nameUz,
                specializationRu: d.specializationRu,
                specializationUz: d.specializationUz,
                color: d.color,
                userId,
                cabinetId: await cabinetId(d.cabinetNumber),
                isActive: true,
              },
              select: { id: true },
            });
            await writeLinks(doctor.id, d.slug);
            await writeSchedule(doctor.id, d.slug);
            break;
          }
          case "doctor.activate":
          case "doctor.deactivate":
            // Doctor.isActive only: the login (User.active) stays as the
            // admin left it, a dismissed doctor must not sign in again.
            await tx.doctor.update({
              where: { id: op.id },
              data: { isActive: op.kind === "doctor.activate" },
            });
            break;
          case "doctor.services":
            await writeLinks(op.id, op.slug);
            break;
          case "doctor.prices":
            for (const sv of specOf(op.slug).services) {
              await tx.serviceOnDoctor.updateMany({
                where: { doctorId: op.id, serviceId: await serviceId(sv.code) },
                data: {
                  priceOverride: sv.priceOverride ?? null,
                },
              });
            }
            break;
          case "doctor.schedule":
            await writeSchedule(op.id, op.slug);
            break;
        }
      }
    },
    { timeout: 60_000 },
  );

  console.log(`\n✅ neurofax catalog: ${writes.length} change(s) applied in one transaction`);
  printIssuedPasswords();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
