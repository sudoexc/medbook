/**
 * MEGA seed for neurofax clinic — wipes existing domain data and rebuilds
 * a rich, varied, "actively-working clinic" snapshot for demo / boss-review.
 *
 * Preserves:
 *   - Clinic, Branch, User, Doctor, Service, Cabinet
 *   - DoctorSchedule, DoctorTimeOff, DoctorPreset, NotificationTemplate
 *   - ClinicCatalogOverlay, ProviderConnection, Subscription, ExchangeRate
 *   - ReferralCode, TelegramInviteToken, UserSession
 *
 * Wipes (then re-seeds):
 *   Patient + family/allergy/chronic/diagnosis/view/review/referralReward
 *   Appointment + AppointmentService + EmptySlotSnapshot
 *   MedicalCase + VisitNote + Prescription + EPrescription + SickLeave
 *   LabOrder + LabResult + MedicationReminderSend + Reminder + CdsOverride
 *   Payment + Invoice + Document + Communication
 *   Conversation + Message
 *   NotificationSend + Campaign + Call + OnlineRequest + Lead + Action
 *   AuditLog (this clinic only) + DataExportJob + DataDeletionJob + LLMUsage
 *
 * Run from worker container:
 *   docker compose exec worker npx tsx scripts/seed-mega-neurofax.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { tashkentComponents, toTashkentDate } from "../src/lib/booking-validation";
import { seedTodayLiveQueue, todayScheduledDoctors } from "./_live-queue-seed";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

// ─── helpers ────────────────────────────────────────────────────────────────
const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(arr: readonly T[]): T => arr[rand(arr.length)]!;
const pickN = <T>(arr: readonly T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) out.push(copy.splice(rand(copy.length), 1)[0]!);
  return out;
};
const chance = (p: number) => Math.random() < p;
const addDays = (d: Date, days: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
};
const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

type Segment = "VIP" | "ACTIVE" | "NEW" | "DORMANT" | "CHURN";

// ─── reference data ─────────────────────────────────────────────────────────
const FIRST_MALE_RU = ["Иван", "Алексей", "Сергей", "Дмитрий", "Андрей", "Михаил", "Артём", "Николай"];
const FIRST_MALE_UZ = ["Бобур", "Алишер", "Сардор", "Ойбек", "Фарход", "Дилшод", "Шерзод", "Улугбек", "Мухаммад", "Жасур", "Аброр", "Хасан"];
const FIRST_FEM_RU = ["Анна", "Елена", "Ольга", "Татьяна", "Наталья", "Мария", "Екатерина", "Виктория"];
const FIRST_FEM_UZ = ["Азиза", "Феруза", "Камила", "Нигора", "Мадина", "Гулнора", "Зарина", "Севара", "Дилфуза", "Шахноза"];
const LAST_UZ = ["Каримов", "Усманов", "Юлдашев", "Хасанов", "Турсунов", "Махмудов", "Рахимов", "Аширов", "Юсупов", "Тошматов", "Назаров", "Расулов", "Ниязов", "Эшонов"];
const LAST_RU = ["Иванов", "Петров", "Сидоров", "Кузнецов", "Смирнов", "Попов", "Соколов", "Лебедев"];
const PATRONYMIC_M = ["Алишерович", "Бобуровна", "Маликович", "Шерзодович", "Олегович", "Викторович"];
const PATRONYMIC_F = ["Алишеровна", "Бобуровна", "Маликовна", "Шерзодовна", "Олеговна", "Викторовна"];

const COMPLAINTS = [
  "Головная боль, тошнота, давление 150/95",
  "Боль в груди при нагрузке",
  "Хронический кашель более 3 недель",
  "Боли в пояснице, иррадиирующие в ногу",
  "Высокая температура, озноб 2 дня",
  "Сыпь и зуд на руках",
  "Нарушение сна, тревожность",
  "Боли в животе после еды",
  "Онемение пальцев правой руки",
  "Снижение зрения на левом глазу",
  "Профилактический осмотр",
  "Контроль артериального давления",
  "Боль в горле, температура 38.5",
  "Тяжесть в правом подреберье",
  "Гипертонический криз вчера вечером",
];
const DIAGNOSES = [
  { text: "Артериальная гипертензия II степени", code: "I10" },
  { text: "Острый бронхит", code: "J20" },
  { text: "Гастрит хронический", code: "K29.5" },
  { text: "Дорсопатия поясничного отдела", code: "M54.5" },
  { text: "Мигрень без ауры", code: "G43.0" },
  { text: "ОРВИ", code: "J06.9" },
  { text: "Атопический дерматит", code: "L20.9" },
  { text: "Тревожное расстройство", code: "F41.1" },
  { text: "Холецистит хронический", code: "K81.1" },
  { text: "Сахарный диабет 2 типа, компенсированный", code: "E11" },
  { text: "Ангина", code: "J03" },
  { text: "Остеохондроз шейного отдела", code: "M50" },
];
const ALLERGIES = ["Пенициллин", "Анальгин", "Пыльца берёзы", "Кошачья шерсть", "Цитрусовые", "Орехи", "Йод", "Пыль", "Латекс"];
const CHRONIC = ["Артериальная гипертензия", "Сахарный диабет 2 типа", "Хронический гастрит", "Бронхиальная астма", "Хронический пиелонефрит", "ИБС"];

const ACTION_TYPES = [
  { type: "no_show_today", severity: "medium" },
  { type: "missed_call", severity: "low" },
  { type: "expiring_lab_referral", severity: "medium" },
  { type: "pending_confirmation", severity: "low" },
  { type: "vip_today", severity: "high" },
  { type: "long_idle_doctor", severity: "low" },
  { type: "empty_slot_today", severity: "medium" },
  { type: "callback_promised", severity: "medium" },
  { type: "dormant_active", severity: "low" },
];

const REVIEW_TEXTS_POS = [
  "Очень внимательный врач, всё подробно объяснил.",
  "Записывались по телеграму, удобно. Приём вовремя, без очередей.",
  "Доктор спас. Рекомендую всем родственникам.",
  "Чистая клиника, профессиональный персонал.",
];
const REVIEW_TEXTS_MIXED = [
  "В целом нормально, но пришлось ждать 20 минут.",
  "Врач хороший, но администратор был не очень приветлив.",
  "Дороговато, но качество соответствует.",
];

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  const slug = "neurofax";
  const clinic = await prisma.clinic.findUnique({ where: { slug } });
  if (!clinic) throw new Error(`clinic '${slug}' not found`);
  const clinicId = clinic.id;
  console.log(`▶ target clinic: ${slug} (${clinicId})\n`);

  // Reference rows that MUST already exist.
  const doctors = await prisma.doctor.findMany({ where: { clinicId, isActive: true } });
  const services = await prisma.service.findMany({ where: { clinicId, isActive: true } });
  const cabinets = await prisma.cabinet.findMany({ where: { clinicId, isActive: true } });
  const users = await prisma.user.findMany({ where: { clinicId } });
  const operators = users.filter((u) => ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"].includes(u.role));
  if (doctors.length === 0 || services.length === 0 || cabinets.length === 0) {
    throw new Error(`need doctors/services/cabinets — got ${doctors.length}/${services.length}/${cabinets.length}`);
  }
  console.log(`  ${doctors.length} doctors · ${services.length} services · ${cabinets.length} cabinets · ${users.length} users\n`);

  // ── 1. WIPE phase ─────────────────────────────────────────────────────────
  console.log("┌─ WIPE phase");
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
  // Discover tables + their clinicId column.
  const tableColumns = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'clinicId'`,
  );
  const hasClinicId = new Set(tableColumns.map((r) => r.table_name));
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
      if (res > 0) console.log(`  ✗ ${table}: -${res}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  ! ${table}: ${msg.slice(0, 160)}`);
    }
  }
  // Reset patient counter so new patients start at P-00001.
  await prisma.clinic.update({ where: { id: clinicId }, data: { patientCounter: 0 } });
  console.log("└─ wipe done\n");

  // ── 2. SEED patients ──────────────────────────────────────────────────────
  console.log("┌─ SEED patients");
  const PATIENT_COUNT = 260;
  const segDistribution: Segment[] = [
    ...Array<Segment>(10).fill("VIP"),
    ...Array<Segment>(60).fill("ACTIVE"),
    ...Array<Segment>(30).fill("NEW"),
    ...Array<Segment>(35).fill("DORMANT"),
    ...Array<Segment>(15).fill("CHURN"),
  ];

  const now = new Date();
  const patients: { id: string; segment: string; isFemale: boolean; isMinor: boolean }[] = [];

  for (let i = 0; i < PATIENT_COUNT; i++) {
    const isFemale = chance(0.55);
    const useUz = chance(0.7);
    const first = useUz
      ? isFemale ? pick(FIRST_FEM_UZ) : pick(FIRST_MALE_UZ)
      : isFemale ? pick(FIRST_FEM_RU) : pick(FIRST_MALE_RU);
    const last = useUz ? pick(LAST_UZ) : pick(LAST_RU);
    const patronymic = isFemale ? pick(PATRONYMIC_F) : pick(PATRONYMIC_M);
    const fullName = `${last} ${first} ${patronymic}`;
    // Age distribution: 8% kids, 7% teens, 65% adults, 20% seniors
    const ageBucket = Math.random();
    const age =
      ageBucket < 0.08 ? 2 + rand(11)
      : ageBucket < 0.15 ? 13 + rand(5)
      : ageBucket < 0.8 ? 18 + rand(45)
      : 63 + rand(25);
    const birthDate = new Date(now.getFullYear() - age, rand(12), 1 + rand(28));
    const phone = `9${["0", "1", "3", "5", "8", "9"][rand(6)]}${String(1000000 + rand(9000000))}`;
    const phoneNormalized = `+998${phone}`;
    const segment = segDistribution[i % segDistribution.length]!;

    // last-visit timestamp depends on segment so the dashboards look right
    const lastVisitOffsetDays =
      segment === "VIP" ? -3 - rand(20)
      : segment === "ACTIVE" ? -2 - rand(40)
      : segment === "NEW" ? -2 - rand(10)
      : segment === "DORMANT" ? -100 - rand(160)
      : -260 - rand(180); // CHURN
    const lastVisitAt = addDays(now, lastVisitOffsetDays);
    const lastContactedAt = addDays(lastVisitAt, rand(7));

    await prisma.$transaction(async (tx) => {
      const c = await tx.clinic.update({
        where: { id: clinicId },
        data: { patientCounter: { increment: 1 } },
        select: { patientCounter: true },
      });
      const p = await tx.patient.create({
        data: {
          clinicId,
          patientNumber: c.patientCounter,
          fullName,
          phone,
          phoneNormalized,
          birthDate,
          gender: isFemale ? "FEMALE" : "MALE",
          segment,
          preferredChannel: chance(0.65) ? "TG" : chance(0.5) ? "SMS" : "CALL",
          preferredLang: useUz ? "UZ" : "RU",
          source: pick(["TELEGRAM", "WEBSITE", "CALL", "WALKIN", "INSTAGRAM"] as const),
          ltv: Math.round((segment === "VIP" ? 3_000_000 + rand(7_000_000) : segment === "ACTIVE" ? 800_000 + rand(2_500_000) : segment === "DORMANT" ? 200_000 + rand(800_000) : segment === "NEW" ? 0 : 100_000 + rand(400_000))),
          visitsCount: segment === "VIP" ? 8 + rand(20) : segment === "ACTIVE" ? 3 + rand(8) : segment === "NEW" ? 0 : segment === "DORMANT" ? 1 + rand(5) : 1 + rand(3),
          balance: chance(0.1) ? -50_000 - rand(200_000) : chance(0.2) ? 50_000 + rand(300_000) : 0,
          discountPct: segment === "VIP" ? pick([5, 10, 15]) : 0,
          lastVisitAt: segment === "NEW" ? null : lastVisitAt,
          lastContactedAt: segment === "NEW" ? null : lastContactedAt,
          consentMarketing: chance(0.85),
          notes: chance(0.15) ? pick([
            "Предпочитает женского врача",
            "Не любит ждать, лучше первый слот",
            "Хорошо говорит по-узбекски",
            "С супругом — VIP пара",
            "Платит наличными всегда",
          ]) : null,
          tags: chance(0.2) ? pickN(["хроник", "семейный", "корпоративный", "по рекомендации", "повторный", "по страховке"], 1 + rand(2)) : [],
        },
      });
      patients.push({ id: p.id, segment, isFemale, isMinor: age < 18 });
    });
  }
  console.log(`  ✓ patients: +${patients.length}\n`);

  // ── 3. Patient family groups (parent-child) ───────────────────────────────
  console.log("┌─ SEED family groups");
  const minors = patients.filter((p) => p.isMinor);
  const adults = patients.filter((p) => !p.isMinor);
  let familyCount = 0;
  for (const minor of minors) {
    if (chance(0.85) && adults.length > 0) {
      const parent = pick(adults);
      try {
        await prisma.patientFamily.create({
          data: {
            clinicId,
            ownerPatientId: parent.id,
            linkedPatientId: minor.id,
            relationship: "child",
          },
        });
        familyCount++;
      } catch {/* unique collision — skip */}
    }
  }
  console.log(`  ✓ family links: +${familyCount}\n`);

  // ── 4. Allergies / chronics / diagnoses for ~30% of patients ──────────────
  console.log("┌─ SEED clinical history");
  let allergyN = 0, chronicN = 0, diagN = 0;
  for (const p of patients) {
    if (chance(0.25)) {
      const items = pickN(ALLERGIES, 1 + rand(2));
      for (const a of items) {
        await prisma.patientAllergy.create({
          data: { clinicId, patientId: p.id, substance: a, severity: pick(["MILD", "MODERATE", "SEVERE"] as const) },
        });
        allergyN++;
      }
    }
    if (chance(0.2) && p.segment !== "NEW") {
      const items = pickN(CHRONIC, 1 + rand(1));
      for (const c of items) {
        await prisma.patientChronicCondition.create({
          data: { clinicId, patientId: p.id, name: c, sinceDate: addDays(now, -365 - rand(2000)) },
        });
        chronicN++;
      }
    }
    if (chance(0.18) && p.segment !== "NEW") {
      const d = pick(DIAGNOSES);
      await prisma.patientDiagnosis.create({
        data: { clinicId, patientId: p.id, icd10Code: d.code, label: d.text, diagnosedAt: addDays(now, -30 - rand(700)) },
      });
      diagN++;
    }
  }
  console.log(`  ✓ allergies: +${allergyN} · chronics: +${chronicN} · diagnoses: +${diagN}\n`);

  // ── 5. Appointments (~700: 30d past + today + 14d future) ─────────────────
  console.log("┌─ SEED appointments");
  const appointments: { id: string; patientId: string; doctorId: string; serviceId: string; status: string; date: Date; price: number; segment: string }[] = [];
  const slotKey = (doctorId: string, date: Date) => `${doctorId}|${date.toISOString()}`;
  const taken = new Set<string>();

  const tryPlace = async (params: {
    patientId: string;
    segment: string;
    dayOffset: number;
    statusBias: ("BOOKED" | "WAITING" | "IN_PROGRESS" | "COMPLETED" | "NO_SHOW" | "CANCELLED" | "SKIPPED")[];
  }) => {
    const { patientId, segment, dayOffset, statusBias } = params;
    // Build the slot at Tashkent wall-clock (prod runs UTC; a server-local
    // setHours would skew the stored instant −5h and leave `time` blank).
    const dayStr = tashkentComponents(addDays(now, dayOffset)).date;
    for (let attempt = 0; attempt < 8; attempt++) {
      const doctor = pick(doctors);
      const service = pick(services);
      const cabinet = pick(cabinets);
      const hour = 9 + rand(9);
      const minute = pick([0, 15, 30, 45]);
      const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const date = toTashkentDate(dayStr, time);
      const key = slotKey(doctor.id, date);
      if (taken.has(key)) continue;
      const status = pick(statusBias);
      const price = service.priceBase;
      try {
        const appt = await prisma.appointment.create({
          data: {
            clinicId,
            patientId,
            doctorId: doctor.id,
            cabinetId: cabinet.id,
            serviceId: service.id,
            date,
            time,
            durationMin: service.durationMin,
            endDate: addMin(date, service.durationMin),
            status,
            queueStatus: status,
            channel: pick(["TELEGRAM", "PHONE", "WEBSITE"] as const),
            priceService: price,
            priceBase: price,
            priceFinal: price,
            completedAt: status === "COMPLETED" ? addMin(date, service.durationMin) : null,
          },
        });
        taken.add(key);
        await prisma.appointmentService.create({
          data: { clinicId, appointmentId: appt.id, serviceId: service.id, priceSnap: price, quantity: 1 },
        });
        appointments.push({ id: appt.id, patientId, doctorId: doctor.id, serviceId: service.id, status, date, price, segment });
        return true;
      } catch {/* overlap or unique-slot violation — retry */}
    }
    return false;
  };

  // Past 30 days: ~25 appts/day
  for (let d = -30; d <= -1; d++) {
    const apptCount = 24 + rand(16);
    for (let i = 0; i < apptCount; i++) {
      const patient = pick(patients);
      // CHURN рerely visit; NEW have none in past; VIP/ACTIVE most of the volume
      if (patient.segment === "NEW") continue;
      if (patient.segment === "CHURN" && chance(0.85)) continue;
      const r = Math.random();
      const status =
        r < 0.7 ? "COMPLETED"
        : r < 0.8 ? "NO_SHOW"
        : r < 0.95 ? "CANCELLED"
        : "SKIPPED";
      await tryPlace({ patientId: patient.id, segment: patient.segment, dayOffset: d, statusBias: [status] });
    }
  }
  // Today: a believable LIVE queue per board-visible doctor, built the way the
  // real walk-in / check-in paths do — two-lanes (live FIFO ⊥ schedule), immutable ticketSeq,
  // queuedAt anchor, a «срочно» bump and a late-arrival demotion. Only doctors
  // with an active schedule for today's weekday appear on the board, so we seed
  // exactly those (see scripts/_live-queue-seed.ts).
  const liveDoctors = await todayScheduledDoctors(prisma, clinicId, now);
  if (liveDoctors.length === 0) {
    console.log("  ! no doctors scheduled today — live board will be empty");
  } else {
    const live = await seedTodayLiveQueue(prisma, {
      clinicId,
      doctors: liveDoctors,
      services: services.map((s) => ({
        id: s.id,
        durationMin: s.durationMin,
        priceBase: s.priceBase,
      })),
      patients: patients.map((p) => ({ id: p.id })),
      operatorId: operators[0]?.id ?? users[0]?.id ?? null,
      now,
    });
    console.log(
      `  ✓ today live queue: +${live.created} rows across ${liveDoctors.length} doctors (+${live.payments} payments)`,
    );
  }
  // Future 14 days: ~20 appts/day
  for (let d = 1; d <= 14; d++) {
    const apptCount = 22 + rand(12);
    for (let i = 0; i < apptCount; i++) {
      const patient = pick(patients.filter((p) => p.segment !== "CHURN"));
      await tryPlace({ patientId: patient.id, segment: patient.segment, dayOffset: d, statusBias: ["BOOKED"] });
    }
  }
  console.log(`  ✓ appointments: +${appointments.length}\n`);

  // ── 6. Payments for completed appointments ────────────────────────────────
  console.log("┌─ SEED payments");
  let payN = 0;
  for (const a of appointments.filter((x) => x.status === "COMPLETED")) {
    const tip = chance(0.1) ? Math.round(a.price * 0.1) : 0;
    await prisma.payment.create({
      data: {
        clinicId,
        appointmentId: a.id,
        patientId: a.patientId,
        currency: "UZS",
        amount: a.price + tip,
        method: pick(["CASH", "CARD", "PAYME", "CLICK", "TRANSFER"] as const),
        status: "PAID",
        paidAt: addMin(a.date, 30),
      },
    });
    payN++;
  }
  // A few partial/unpaid for variety
  for (let i = 0; i < 8; i++) {
    const a = pick(appointments.filter((x) => x.status === "COMPLETED"));
    if (!a) break;
    await prisma.payment.create({
      data: {
        clinicId, appointmentId: a.id, patientId: a.patientId,
        currency: "UZS", amount: Math.round(a.price * 0.5),
        method: "CASH", status: "PARTIAL", paidAt: addMin(a.date, 30),
      },
    });
  }
  console.log(`  ✓ payments: +${payN}\n`);

  // ── 7. Medical cases (~90) ────────────────────────────────────────────────
  console.log("┌─ SEED medical cases");
  const completedAppts = appointments.filter((a) => a.status === "COMPLETED");
  const caseTitles = ["Гипертония — наблюдение", "ОРВИ — терапия", "Гастрит — обострение", "Боли в спине", "Профилактика", "Послеоперационный контроль"];
  let caseN = 0;
  const byPatient = new Map<string, typeof appointments>();
  for (const a of completedAppts) {
    if (!byPatient.has(a.patientId)) byPatient.set(a.patientId, []);
    byPatient.get(a.patientId)!.push(a);
  }
  for (const [patientId, appts] of byPatient) {
    if (chance(0.55)) {
      const diag = pick(DIAGNOSES);
      const complaint = pick(COMPLAINTS);
      const isClosed = chance(0.5);
      const c = await prisma.medicalCase.create({
        data: {
          clinicId,
          patientId,
          primaryDoctorId: appts[0]!.doctorId,
          title: pick(caseTitles),
          primaryComplaint: complaint,
          diagnosisText: diag.text,
          diagnosisCode: diag.code,
          status: isClosed ? pick(["RESOLVED", "ABANDONED"] as const) : "OPEN",
          openedAt: appts[0]!.date,
          closedAt: isClosed ? appts[appts.length - 1]!.date : null,
          closedReason: isClosed ? pick(["Лечение завершено", "Передан другому врачу", "Пациент отказался"]) : null,
          notes: chance(0.4) ? "Динамика положительная, контроль через 2 недели." : null,
        },
      });
      // Link 1-3 completed appointments to this case
      const linkCount = Math.min(appts.length, 1 + rand(3));
      const linked = pickN(appts, linkCount);
      for (const la of linked) {
        await prisma.appointment.update({ where: { id: la.id }, data: { medicalCaseId: c.id } });
      }
      caseN++;
      if (caseN >= 170) break;
    }
  }
  console.log(`  ✓ medical cases: +${caseN}\n`);

  // ── 8. Calls (~80) + Leads (~15) ──────────────────────────────────────────
  console.log("┌─ SEED calls + leads");
  let callN = 0;
  for (let i = 0; i < 170; i++) {
    const patient = chance(0.8) ? pick(patients) : null;
    const direction = pick(["IN", "OUT", "MISSED"] as const);
    const minutesAgo = rand(60 * 24 * 7);
    const createdAt = new Date(Date.now() - minutesAgo * 60_000);
    const duration = direction === "MISSED" ? null : 30 + rand(420);
    const ops = operators.length > 0 ? operators : users;
    await prisma.call.create({
      data: {
        clinicId,
        direction,
        fromNumber: direction === "IN" || direction === "MISSED" ? (patient ? `+998${patient.id.slice(-9)}` : `+998901234567`) : "+998712001234",
        toNumber: direction === "IN" || direction === "MISSED" ? "+998712001234" : (patient ? `+998${patient.id.slice(-9)}` : `+998901234567`),
        patientId: patient?.id ?? null,
        operatorId: ops.length > 0 ? pick(ops).id : null,
        durationSec: duration,
        summary: chance(0.5) ? pick([
          "Записали на завтра к терапевту",
          "Перенесли запись на следующую неделю",
          "Спросил про услугу УЗИ — отправил прайс в ТГ",
          "Жаловался на долгое ожидание — извинились, дали скидку",
          "Хотел запись к гинекологу — нет свободных, поставили в лист ожидания",
        ]) : null,
        tags: chance(0.3) ? pickN(["перезвонить", "vip", "запись", "жалоба"], 1 + rand(2)) : [],
        sipCallId: `sip-${createdAt.getTime()}-${i}`,
        createdAt,
        endedAt: duration ? new Date(createdAt.getTime() + duration * 1000) : null,
      },
    });
    callN++;
  }
  let leadN = 0;
  for (let i = 0; i < 40; i++) {
    const useUz = chance(0.7);
    const first = useUz ? pick(FIRST_MALE_UZ.concat(FIRST_FEM_UZ)) : pick(FIRST_MALE_RU.concat(FIRST_FEM_RU));
    const last = useUz ? pick(LAST_UZ) : pick(LAST_RU);
    await prisma.lead.create({
      data: {
        clinicId,
        name: `${last} ${first}`,
        phone: `+998${9}${rand(10)}${String(1000000 + rand(9000000))}`,
        source: pick(["TELEGRAM", "WEBSITE", "INSTAGRAM", "CALL"] as const),
        status: pick(["NEW", "CONTACTED", "CONVERTED", "CANCELLED"] as const),
        comment: chance(0.5) ? pick(["Хочет к кардиологу", "Интересовался ценами на УЗИ", "Просил перезвонить вечером"]) : null,
        createdAt: addDays(now, -rand(14)),
      },
    });
    leadN++;
  }
  console.log(`  ✓ calls: +${callN} · leads: +${leadN}\n`);

  // ── 9. NotificationSends (~300) ───────────────────────────────────────────
  console.log("┌─ SEED notification sends");
  const templates = await prisma.notificationTemplate.findMany({ where: { clinicId } });
  let notifN = 0;
  for (const a of appointments) {
    // Past completed → reminder 24h sent OK
    if (a.status === "COMPLETED" && chance(0.6)) {
      const tpl = templates.find((t) => t.key === "reminder.24h");
      await prisma.notificationSend.create({
        data: {
          clinicId,
          templateId: tpl?.id ?? null,
          patientId: a.patientId,
          appointmentId: a.id,
          channel: "TG",
          recipient: `tg:${a.patientId.slice(-8)}`,
          body: "Напоминаем о приёме завтра.",
          status: "DELIVERED",
          scheduledFor: addDays(a.date, -1),
          sentAt: addDays(a.date, -1),
          deliveredAt: addDays(a.date, -1),
        },
      });
      notifN++;
    }
    // Future booked → reminder scheduled
    if (a.status === "BOOKED" && chance(0.4)) {
      const tpl = templates.find((t) => t.key === "reminder.24h");
      await prisma.notificationSend.create({
        data: {
          clinicId,
          templateId: tpl?.id ?? null,
          patientId: a.patientId,
          appointmentId: a.id,
          channel: "TG",
          recipient: `tg:${a.patientId.slice(-8)}`,
          body: "Напоминаем о приёме завтра.",
          status: "QUEUED",
          scheduledFor: addDays(a.date, -1),
        },
      });
      notifN++;
    }
    // Some failed sends for realism
    if (a.status === "NO_SHOW" && chance(0.5)) {
      await prisma.notificationSend.create({
        data: {
          clinicId,
          patientId: a.patientId,
          appointmentId: a.id,
          channel: "TG",
          recipient: `tg:${a.patientId.slice(-8)}`,
          body: "Напоминание не доставлено.",
          status: "FAILED",
          scheduledFor: addDays(a.date, -1),
          sentAt: addDays(a.date, -1),
          failedReason: "Telegram: bot blocked by user",
        },
      });
      notifN++;
    }
    if (notifN >= 760) break;
  }
  console.log(`  ✓ notification sends: +${notifN}\n`);

  // ── 10. Actions for Action Center ────────────────────────────────────────
  console.log("┌─ SEED action center");
  let actionN = 0;
  for (let i = 0; i < 70; i++) {
    const t = pick(ACTION_TYPES);
    const p = pick(patients);
    try {
      await prisma.action.create({
        data: {
          clinicId,
          type: t.type,
          severity: t.severity,
          payload: { patientId: p.id, patientName: `Пациент #${p.id.slice(-4)}`, hint: pick(["перезвонить", "подтвердить запись", "переназначить", "уточнить"]) },
          status: chance(0.7) ? "OPEN" : pick(["SNOOZED", "DONE", "DISMISSED"]),
          assigneeRole: pick(["ADMIN", "RECEPTIONIST", null] as const),
          deeplinkPath: `/crm/patients/${p.id}`,
          dedupeKey: `${t.type}:${p.id}:${i}`,
          createdAt: addDays(now, -rand(3)),
        },
      });
      actionN++;
    } catch {/* dedupeKey collision */}
  }
  console.log(`  ✓ actions: +${actionN}\n`);

  // ── 11. Documents (~50) ──────────────────────────────────────────────────
  console.log("┌─ SEED documents");
  let docN = 0;
  for (let i = 0; i < 130; i++) {
    const a = pick(appointments.filter((x) => x.status === "COMPLETED"));
    if (!a) break;
    await prisma.document.create({
      data: {
        clinicId,
        patientId: a.patientId,
        appointmentId: a.id,
        type: pick(["RESULT", "REFERRAL", "PRESCRIPTION", "RECEIPT", "OTHER"] as const),
        title: pick(["Результат УЗИ", "Анализ крови", "Направление на МРТ", "Рецепт", "Квитанция", "Заключение терапевта"]),
        fileUrl: `s3://medbook/${a.patientId}/${a.id}/doc-${i}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 50_000 + rand(950_000),
        uploadedById: users[0]?.id ?? null,
        createdAt: addMin(a.date, 30 + rand(60)),
      },
    });
    docN++;
  }
  console.log(`  ✓ documents: +${docN}\n`);

  // ── 12. Conversations + messages (~10) ────────────────────────────────────
  console.log("┌─ SEED conversations");
  let convN = 0, msgN = 0;
  const vipPatients = patients.filter((p) => p.segment === "VIP" || p.segment === "ACTIVE").slice(0, 30);
  for (const p of vipPatients) {
    const conv = await prisma.conversation.create({
      data: {
        clinicId,
        channel: "TG",
        patientId: p.id,
        externalId: `tg-${p.id.slice(-10)}`,
        contactFirstName: p.isFemale ? pick(FIRST_FEM_UZ) : pick(FIRST_MALE_UZ),
        status: chance(0.7) ? "OPEN" : "CLOSED",
        tags: chance(0.4) ? ["активный"] : [],
        lastMessageAt: addDays(now, -rand(3)),
        lastMessageText: pick(["Спасибо!", "Когда могу прийти?", "Сколько стоит?", "Записался"]),
        unreadCount: chance(0.5) ? 0 : rand(3),
      },
    });
    convN++;
    const turnCount = 3 + rand(6);
    for (let i = 0; i < turnCount; i++) {
      const inbound = i % 2 === 0;
      await prisma.message.create({
        data: {
          clinicId,
          conversationId: conv.id,
          direction: inbound ? "IN" : "OUT",
          body: inbound
            ? pick(["Здравствуйте!", "Можно записаться?", "Сколько стоит УЗИ?", "Когда удобно?", "Подтверждаю запись"])
            : pick(["Здравствуйте! Чем можем помочь?", "На какое время удобно?", "УЗИ стоит 250 000 сум.", "Завтра в 10:00 есть слот.", "Записали, ждём вас!"]),
          status: "DELIVERED",
          externalId: `msg-${conv.id}-${i}`,
          createdAt: addDays(now, -rand(3) - i / 10),
        },
      });
      msgN++;
    }
  }
  console.log(`  ✓ conversations: +${convN} · messages: +${msgN}\n`);

  // ── 13. PatientReviews (~25) ──────────────────────────────────────────────
  console.log("┌─ SEED reviews");
  let reviewN = 0;
  for (const p of pickN(patients.filter((x) => x.segment !== "CHURN"), 70)) {
    const score = chance(0.7) ? 10 : chance(0.7) ? 8 : 6;
    await prisma.patientReview.create({
      data: {
        clinicId,
        patientId: p.id,
        doctorId: pick(doctors).id,
        score,
        comment: score >= 8 ? pick(REVIEW_TEXTS_POS) : pick(REVIEW_TEXTS_MIXED),
        source: pick(["tg-miniapp", "tg-bot", "manual"] as const),
        respondedAt: addDays(now, -rand(60)),
        createdAt: addDays(now, -rand(60)),
      },
    });
    reviewN++;
  }
  console.log(`  ✓ reviews: +${reviewN}\n`);

  // ── done ─────────────────────────────────────────────────────────────────
  await prisma.$disconnect();
  console.log("\n═══ MEGA SEED COMPLETE ═══");
  console.log(`  ${patients.length} patients · ${appointments.length} appointments · ${caseN} cases`);
  console.log(`  ${callN} calls · ${leadN} leads · ${actionN} actions`);
  console.log(`  ${notifN} notifications · ${docN} documents · ${convN} conversations`);
  console.log(`  ${reviewN} reviews · ${payN} payments`);
}

main().catch(async (e) => {
  console.error("\n✗ seed failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
