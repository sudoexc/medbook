/**
 * Comprehensive QA seed for the doctor cabinet.
 *
 * Target: clinic=neurofax, doctor=neurologist@neurofax.uz
 * Password: doctor
 *
 * Covers every visible page/state in /doctor/*:
 * - my-day (today queue across all statuses, pending labs, due reminders, unread chats)
 * - reception (active IN_PROGRESS appointment with DRAFT visit note)
 * - patients (NEW/ACTIVE/DORMANT/VIP/CHURN segments + active-appointment flag mix)
 * - visits (history with FINALIZED notes)
 * - conclusions (DRAFT + FINALIZED notes)
 * - documents (RESULT/REFERRAL/PRESCRIPTION attached to past appointments)
 * - messages (conversations across SMS/TG/EMAIL channels with unread counts)
 * - notifications/reminders (PENDING past-due, today, SNOOZED, DONE; with + without patient)
 * - settings (signatureUrl set, DoctorNotificationPref row materialized)
 *
 * Idempotent: cleans rows tagged with the QA_TAG prefix before re-seeding.
 *
 *   npx tsx scripts/seed-doctor-qa.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const QA_TAG = "QA-DOCTOR";
const QA_PHONE_PREFIX = "+99890QA"; // unique prefix on phoneNormalized
const QA_NOTE_TAG = `[${QA_TAG}]`;

const DOCTOR_EMAIL = "neurologist@neurofax.uz";

function daysFromNow(days: number, hour = 9, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function todayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

function plusMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

async function clean(clinicId: string, doctorId: string, doctorUserId: string) {
  // Patients with our QA phone prefix — cascade-style cleanup downstream.
  const qaPatients = await prisma.patient.findMany({
    where: { clinicId, phoneNormalized: { startsWith: QA_PHONE_PREFIX } },
    select: { id: true },
  });
  const patientIds = qaPatients.map((p) => p.id);

  if (patientIds.length === 0) return;

  await prisma.message.deleteMany({
    where: { clinicId, conversation: { patientId: { in: patientIds } } },
  });
  await prisma.conversation.deleteMany({
    where: { clinicId, patientId: { in: patientIds } },
  });
  await prisma.labResult.deleteMany({
    where: { clinicId, patientId: { in: patientIds } },
  });
  await prisma.reminder.deleteMany({
    where: { clinicId, doctorId: doctorUserId, patientId: { in: patientIds } },
  });
  // Doctor-scoped reminders that are not tied to any patient — wipe by
  // title-prefix so re-runs don't accumulate.
  await prisma.reminder.deleteMany({
    where: { clinicId, doctorId: doctorUserId, title: { startsWith: QA_NOTE_TAG } },
  });
  await prisma.document.deleteMany({
    where: { clinicId, patientId: { in: patientIds } },
  });
  // VisitNotes are on Appointments — kill notes for our QA appointments first.
  const qaAppts = await prisma.appointment.findMany({
    where: { clinicId, patientId: { in: patientIds } },
    select: { id: true },
  });
  const apptIds = qaAppts.map((a) => a.id);
  if (apptIds.length > 0) {
    await prisma.visitNote.deleteMany({ where: { appointmentId: { in: apptIds } } });
    await prisma.appointmentService.deleteMany({ where: { appointmentId: { in: apptIds } } });
    await prisma.payment.deleteMany({ where: { clinicId, appointmentId: { in: apptIds } } });
    await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
  }
  await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
}

async function main() {
  const doctorUser = await prisma.user.findFirst({
    where: { email: DOCTOR_EMAIL, role: "DOCTOR" },
    select: { id: true, clinicId: true, name: true },
  });
  if (!doctorUser) throw new Error(`Doctor user ${DOCTOR_EMAIL} not found`);
  const doctor = await prisma.doctor.findFirst({
    where: { userId: doctorUser.id },
    select: { id: true, clinicId: true, slug: true, nameRu: true },
  });
  if (!doctor) throw new Error(`Doctor row for user ${doctorUser.id} not found`);
  const clinicId = doctor.clinicId;
  const doctorId = doctor.id;
  const doctorUserId = doctorUser.id;
  console.log(
    `[seed] Target: ${doctor.nameRu} (Doctor.id=${doctorId}, User.id=${doctorUserId}, clinic=${clinicId})`,
  );

  await clean(clinicId, doctorId, doctorUserId);
  console.log("[seed] Cleaned prior QA data.");

  // ─── 1. Patients across all segments ──────────────────────────────────────
  const patientsBlueprint: Array<{
    name: string;
    phone: string;
    segment: "NEW" | "ACTIVE" | "DORMANT" | "VIP" | "CHURN";
    tags: string[];
    lastVisitAt: Date | null;
    visitsCount: number;
    telegramId: string | null;
    gender: "MALE" | "FEMALE";
    birthYear: number;
  }> = [
    { name: "QA Иванова Анна Петровна", phone: `${QA_PHONE_PREFIX}01`, segment: "ACTIVE", tags: ["VIP", "вернулся"], lastVisitAt: daysFromNow(-3), visitsCount: 7, telegramId: "qa_tg_anna", gender: "FEMALE", birthYear: 1985 },
    { name: "QA Сидоров Михаил Сергеевич", phone: `${QA_PHONE_PREFIX}02`, segment: "ACTIVE", tags: [], lastVisitAt: daysFromNow(-12), visitsCount: 4, telegramId: null, gender: "MALE", birthYear: 1978 },
    { name: "QA Каримова Дильноза", phone: `${QA_PHONE_PREFIX}03`, segment: "NEW", tags: ["new"], lastVisitAt: null, visitsCount: 0, telegramId: null, gender: "FEMALE", birthYear: 1995 },
    { name: "QA Ахмеджанов Тимур", phone: `${QA_PHONE_PREFIX}04`, segment: "VIP", tags: ["VIP", "крупный_заказ"], lastVisitAt: daysFromNow(-2), visitsCount: 18, telegramId: "qa_tg_timur", gender: "MALE", birthYear: 1971 },
    { name: "QA Юлдашева Малика", phone: `${QA_PHONE_PREFIX}05`, segment: "DORMANT", tags: [], lastVisitAt: daysFromNow(-220), visitsCount: 2, telegramId: null, gender: "FEMALE", birthYear: 1988 },
    { name: "QA Раджабов Бахтиёр", phone: `${QA_PHONE_PREFIX}06`, segment: "CHURN", tags: ["reactivation_attempt"], lastVisitAt: daysFromNow(-380), visitsCount: 1, telegramId: null, gender: "MALE", birthYear: 1969 },
    { name: "QA Алимова Зарина", phone: `${QA_PHONE_PREFIX}07`, segment: "ACTIVE", tags: ["chronic"], lastVisitAt: daysFromNow(-1), visitsCount: 11, telegramId: "qa_tg_zarina", gender: "FEMALE", birthYear: 1982 },
    { name: "QA Назаров Шерзод", phone: `${QA_PHONE_PREFIX}08`, segment: "NEW", tags: ["new", "first_visit"], lastVisitAt: null, visitsCount: 0, telegramId: null, gender: "MALE", birthYear: 1999 },
    { name: "QA Турсунова Гульнара", phone: `${QA_PHONE_PREFIX}09`, segment: "ACTIVE", tags: [], lastVisitAt: daysFromNow(-45), visitsCount: 3, telegramId: null, gender: "FEMALE", birthYear: 1976 },
    { name: "QA Маликов Жасур", phone: `${QA_PHONE_PREFIX}10`, segment: "DORMANT", tags: ["chronic"], lastVisitAt: daysFromNow(-110), visitsCount: 5, telegramId: "qa_tg_jasur", gender: "MALE", birthYear: 1965 },
    { name: "QA Усманова Севара", phone: `${QA_PHONE_PREFIX}11`, segment: "ACTIVE", tags: ["returned_after_gap"], lastVisitAt: daysFromNow(-7), visitsCount: 6, telegramId: null, gender: "FEMALE", birthYear: 1990 },
    { name: "QA Эшонов Олим", phone: `${QA_PHONE_PREFIX}12`, segment: "NEW", tags: ["new"], lastVisitAt: null, visitsCount: 0, telegramId: null, gender: "MALE", birthYear: 2001 },
  ];

  const patients: { id: string; name: string; segment: string }[] = [];
  for (const p of patientsBlueprint) {
    const row = await prisma.patient.create({
      data: {
        clinicId,
        fullName: p.name,
        phone: p.phone,
        phoneNormalized: p.phone,
        birthDate: new Date(p.birthYear, 0, 15),
        gender: p.gender,
        segment: p.segment,
        tags: p.tags,
        telegramId: p.telegramId,
        telegramUsername: p.telegramId,
        preferredChannel: p.telegramId ? "TG" : "SMS",
        visitsCount: p.visitsCount,
        lastVisitAt: p.lastVisitAt,
        consentMarketing: true,
        notes: `${QA_NOTE_TAG} seed patient`,
      },
      select: { id: true, fullName: true, segment: true },
    });
    patients.push({ id: row.id, name: row.fullName, segment: row.segment });
  }
  console.log(`[seed] Patients: ${patients.length}`);

  // Lookup any service for the doctor + a cabinet
  const service = await prisma.service.findFirst({
    where: { clinicId, isActive: true },
    select: { id: true, durationMin: true, priceBase: true },
  });
  const cabinet = await prisma.cabinet.findFirst({
    where: { clinicId, doctor: { id: doctorId } },
    select: { id: true },
  });

  // ─── 2. Today's appointment queue (all statuses) ──────────────────────────
  type ApptScript = {
    patient: typeof patients[number];
    hour: number;
    minute: number;
    status: "BOOKED" | "WAITING" | "IN_PROGRESS" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
  };
  const todayQueue: ApptScript[] = [
    { patient: patients[0]!, hour: 8, minute: 30, status: "COMPLETED" },
    { patient: patients[1]!, hour: 9, minute: 0, status: "COMPLETED" },
    { patient: patients[2]!, hour: 9, minute: 30, status: "NO_SHOW" },
    { patient: patients[6]!, hour: 10, minute: 0, status: "COMPLETED" },
    { patient: patients[3]!, hour: 10, minute: 30, status: "IN_PROGRESS" },
    { patient: patients[7]!, hour: 11, minute: 0, status: "WAITING" },
    { patient: patients[8]!, hour: 11, minute: 30, status: "BOOKED" },
    { patient: patients[10]!, hour: 12, minute: 0, status: "BOOKED" },
    { patient: patients[11]!, hour: 14, minute: 0, status: "BOOKED" },
    { patient: patients[4]!, hour: 15, minute: 0, status: "CANCELLED" },
    { patient: patients[9]!, hour: 16, minute: 0, status: "BOOKED" },
  ];
  const todayAppts: { id: string; patientId: string; status: string }[] = [];
  for (const item of todayQueue) {
    const date = todayAt(item.hour, item.minute);
    const duration = service?.durationMin ?? 30;
    const endDate = plusMinutes(date, duration);
    const a = await prisma.appointment.create({
      data: {
        clinicId,
        patientId: item.patient.id,
        doctorId,
        cabinetId: cabinet?.id ?? undefined,
        serviceId: service?.id ?? undefined,
        date,
        time: `${String(item.hour).padStart(2, "0")}:${String(item.minute).padStart(2, "0")}`,
        durationMin: duration,
        endDate,
        status: item.status,
        queueStatus: item.status,
        channel: "PHONE",
        priceService: service?.priceBase ?? null,
        priceBase: service?.priceBase ?? null,
        priceFinal: service?.priceBase ?? null,
        startedAt: ["IN_PROGRESS", "COMPLETED"].includes(item.status) ? plusMinutes(date, 2) : null,
        completedAt: item.status === "COMPLETED" ? plusMinutes(date, 28) : null,
        cancelledAt: item.status === "CANCELLED" ? plusMinutes(date, -30) : null,
        notes: `${QA_NOTE_TAG} today queue`,
      },
      select: { id: true, patientId: true, status: true },
    });
    todayAppts.push(a);
  }
  console.log(`[seed] Today's appointments: ${todayAppts.length}`);

  // Helper: find a free 30-min slot for this doctor on the given day, scanning
  // 7:00–18:00 in 5-minute increments. Existing stress-seed data may occupy
  // common round-hour slots, so we scan with offsets.
  async function findFreeSlot(targetDate: Date): Promise<Date> {
    const dayStart = new Date(targetDate);
    dayStart.setHours(7, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(19, 0, 0, 0);
    const busy = await prisma.appointment.findMany({
      where: {
        doctorId,
        date: { gte: dayStart, lt: dayEnd },
        status: { notIn: ["CANCELLED"] },
      },
      select: { date: true, endDate: true },
    });
    for (let minutes = 0; minutes < 12 * 60; minutes += 5) {
      const candidate = new Date(dayStart);
      candidate.setMinutes(candidate.getMinutes() + minutes);
      const cEnd = plusMinutes(candidate, 30);
      const collides = busy.some(
        (b) => candidate < b.endDate && cEnd > b.date,
      );
      if (!collides) return candidate;
    }
    throw new Error(`No free slot for ${targetDate.toISOString()}`);
  }

  // ─── 3. Past completed appointments with FINALIZED visit notes ────────────
  const pastAppts: { id: string; patientId: string }[] = [];
  const pastScripts = [
    { patient: patients[0]!, daysAgo: 14 },
    { patient: patients[0]!, daysAgo: 42 },
    { patient: patients[1]!, daysAgo: 21 },
    { patient: patients[3]!, daysAgo: 7 },
    { patient: patients[6]!, daysAgo: 9 },
    { patient: patients[4]!, daysAgo: 220 },
    { patient: patients[9]!, daysAgo: 110 },
    { patient: patients[10]!, daysAgo: 30 },
  ];
  for (const s of pastScripts) {
    const day = daysFromNow(-s.daysAgo, 10, 0);
    const date = await findFreeSlot(day);
    const endDate = plusMinutes(date, 30);
    const a = await prisma.appointment.create({
      data: {
        clinicId,
        patientId: s.patient.id,
        doctorId,
        cabinetId: cabinet?.id ?? undefined,
        serviceId: service?.id ?? undefined,
        date,
        time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
        durationMin: 30,
        endDate,
        status: "COMPLETED",
        queueStatus: "COMPLETED",
        channel: "PHONE",
        priceService: service?.priceBase ?? null,
        priceBase: service?.priceBase ?? null,
        priceFinal: service?.priceBase ?? null,
        startedAt: plusMinutes(date, 2),
        completedAt: plusMinutes(date, 28),
        notes: `${QA_NOTE_TAG} past completed`,
      },
      select: { id: true, patientId: true },
    });
    pastAppts.push(a);
  }

  // ─── 4. Future BOOKED appointments ────────────────────────────────────────
  for (const [i, p] of [patients[0]!, patients[3]!, patients[6]!, patients[10]!].entries()) {
    const day = daysFromNow(i + 1, 11, 0);
    const date = await findFreeSlot(day);
    await prisma.appointment.create({
      data: {
        clinicId,
        patientId: p.id,
        doctorId,
        cabinetId: cabinet?.id ?? undefined,
        serviceId: service?.id ?? undefined,
        date,
        time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
        durationMin: 30,
        endDate: plusMinutes(date, 30),
        status: "BOOKED",
        queueStatus: "BOOKED",
        channel: "WEBSITE",
        priceService: service?.priceBase ?? null,
        priceBase: service?.priceBase ?? null,
        priceFinal: service?.priceBase ?? null,
        notes: `${QA_NOTE_TAG} future booked`,
      },
    });
  }
  console.log("[seed] Past + future appointments seeded.");

  // ─── 5. VisitNotes — FINALIZED for past, DRAFT for today's IN_PROGRESS/COMPLETED ──
  // FINALIZED on past appointments
  for (const a of pastAppts) {
    await prisma.visitNote.create({
      data: {
        clinicId,
        appointmentId: a.id,
        patientId: a.patientId,
        doctorId,
        status: "FINALIZED",
        startedAt: daysFromNow(-1, 10, 0),
        finalizedAt: daysFromNow(-1, 10, 25),
        complaints: ["Головные боли", "Головокружение"],
        anamnesis: ["Симптомы беспокоят 2 недели", "Без травм в анамнезе"],
        examination: ["АД 130/85", "Без очаговой неврологической симптоматики"],
        prescriptions: ["Магне B6 — 1 табл. 3 раза в день", "Прогулки на свежем воздухе"],
        advice: ["Контроль через 14 дней"],
        diagnosisCode: "G44.2",
        diagnosisName: "Головная боль напряжения",
        bodyMarkdown: `${QA_NOTE_TAG}\n\n## Жалобы\nГоловные боли в течение 2 недель.\n\n## Диагноз\nG44.2 — головная боль напряжения.`,
      },
    });
  }
  // DRAFT for today's IN_PROGRESS + a partial COMPLETED draft
  const inProgress = todayAppts.find((a) => a.status === "IN_PROGRESS");
  if (inProgress) {
    await prisma.visitNote.create({
      data: {
        clinicId,
        appointmentId: inProgress.id,
        patientId: inProgress.patientId,
        doctorId,
        status: "DRAFT",
        startedAt: new Date(),
        complaints: ["Бессонница", "Тревожность"],
        anamnesis: ["Симптомы 1 месяц"],
        examination: [],
        prescriptions: [],
        advice: [],
        bodyMarkdown: `${QA_NOTE_TAG}\n\n## Жалобы\nБессонница, тревожность.\n\n(черновик — не финализировано)`,
      },
    });
  }
  console.log("[seed] VisitNotes seeded.");

  // ─── 6. LabResults — variety of statuses + flags ──────────────────────────
  const labCatalog = [
    { testName: "Глюкоза крови", unit: "ммоль/л", refRange: "3.3-5.5" },
    { testName: "Гемоглобин", unit: "г/л", refRange: "120-160" },
    { testName: "Холестерин общий", unit: "ммоль/л", refRange: "3.0-5.2" },
    { testName: "ТТГ", unit: "мЕд/л", refRange: "0.4-4.0" },
    { testName: "С-реактивный белок", unit: "мг/л", refRange: "0-5" },
    { testName: "Витамин D", unit: "нг/мл", refRange: "30-100" },
  ];
  const labScripts: Array<{
    patient: typeof patients[number];
    test: typeof labCatalog[number];
    value: string;
    flag: "NORMAL" | "LOW" | "HIGH" | "CRITICAL" | null;
    status: "PENDING" | "RESULTED" | "REVIEWED";
    hoursAgo: number;
  }> = [
    { patient: patients[0]!, test: labCatalog[0]!, value: "9.4", flag: "CRITICAL", status: "RESULTED", hoursAgo: 2 },
    { patient: patients[3]!, test: labCatalog[2]!, value: "7.8", flag: "HIGH", status: "RESULTED", hoursAgo: 4 },
    { patient: patients[1]!, test: labCatalog[1]!, value: "108", flag: "LOW", status: "RESULTED", hoursAgo: 6 },
    { patient: patients[6]!, test: labCatalog[3]!, value: "2.1", flag: "NORMAL", status: "RESULTED", hoursAgo: 8 },
    { patient: patients[10]!, test: labCatalog[4]!, value: "12", flag: "HIGH", status: "RESULTED", hoursAgo: 18 },
    { patient: patients[0]!, test: labCatalog[5]!, value: "18", flag: "LOW", status: "REVIEWED", hoursAgo: 48 },
    { patient: patients[3]!, test: labCatalog[0]!, value: "5.1", flag: "NORMAL", status: "REVIEWED", hoursAgo: 72 },
    { patient: patients[6]!, test: labCatalog[2]!, value: "—", flag: null, status: "PENDING", hoursAgo: 1 },
  ];
  for (const l of labScripts) {
    const receivedAt = new Date(Date.now() - l.hoursAgo * 60 * 60 * 1000);
    await prisma.labResult.create({
      data: {
        clinicId,
        patientId: l.patient.id,
        doctorId: doctorUserId,
        testName: l.test.testName,
        value: l.value,
        unit: l.test.unit,
        refRange: l.test.refRange,
        flag: l.flag,
        status: l.status,
        receivedAt,
        reviewedAt: l.status === "REVIEWED" ? plusMinutes(receivedAt, 30) : null,
        reviewedBy: l.status === "REVIEWED" ? doctorUserId : null,
        notes: `${QA_NOTE_TAG} lab`,
      },
    });
  }
  console.log(`[seed] LabResults: ${labScripts.length}`);

  // ─── 7. Reminders — past-due, today, future, snoozed, done ────────────────
  const reminderScripts: Array<{
    patient: typeof patients[number] | null;
    title: string;
    body: string | null;
    offsetMin: number;
    status: "PENDING" | "DONE" | "DISMISSED" | "SNOOZED";
  }> = [
    { patient: patients[0]!, title: `${QA_NOTE_TAG} Перезвонить по результатам лаб.`, body: "Глюкоза 9.4 — критическое", offsetMin: -60 * 6, status: "PENDING" }, // past-due
    { patient: patients[1]!, title: `${QA_NOTE_TAG} Уточнить дозу препарата`, body: null, offsetMin: -45, status: "PENDING" }, // past-due, today
    { patient: patients[3]!, title: `${QA_NOTE_TAG} Контрольный осмотр через 2 нед`, body: "Холестерин 7.8", offsetMin: 60, status: "PENDING" }, // soon
    { patient: patients[6]!, title: `${QA_NOTE_TAG} Подготовить выписку`, body: null, offsetMin: 60 * 3, status: "PENDING" }, // later today
    { patient: null, title: `${QA_NOTE_TAG} Заказать бланки в регистратуре`, body: null, offsetMin: 60 * 24, status: "PENDING" }, // tomorrow
    { patient: patients[4]!, title: `${QA_NOTE_TAG} Связаться по реактивации`, body: null, offsetMin: 60 * 5, status: "SNOOZED" },
    { patient: patients[7]!, title: `${QA_NOTE_TAG} Проверить рецепт`, body: null, offsetMin: -60 * 24, status: "DONE" },
    { patient: null, title: `${QA_NOTE_TAG} Старая задача`, body: null, offsetMin: -60 * 72, status: "DISMISSED" },
  ];
  for (const r of reminderScripts) {
    await prisma.reminder.create({
      data: {
        clinicId,
        doctorId: doctorUserId,
        patientId: r.patient?.id ?? null,
        title: r.title,
        body: r.body,
        remindAt: new Date(Date.now() + r.offsetMin * 60 * 1000),
        status: r.status,
        completedAt: r.status === "DONE" ? new Date() : null,
      },
    });
  }
  console.log(`[seed] Reminders: ${reminderScripts.length}`);

  // ─── 8. Conversations + Messages ──────────────────────────────────────────
  const convoScripts: Array<{
    patient: typeof patients[number];
    channel: "SMS" | "TG" | "EMAIL";
    unread: number;
    lastMsg: string;
  }> = [
    { patient: patients[0]!, channel: "TG", unread: 3, lastMsg: "Доктор, можно я приду на час позже?" },
    { patient: patients[3]!, channel: "TG", unread: 1, lastMsg: "Спасибо за консультацию!" },
    { patient: patients[6]!, channel: "SMS", unread: 2, lastMsg: "Где можно сдать анализы?" },
    { patient: patients[1]!, channel: "SMS", unread: 0, lastMsg: "Понял, спасибо" },
    { patient: patients[10]!, channel: "EMAIL", unread: 0, lastMsg: "Прикладываю результаты МРТ" },
  ];
  for (const c of convoScripts) {
    const now = new Date();
    const externalId = `qa-${c.patient.id}-${c.channel}`;
    const convo = await prisma.conversation.create({
      data: {
        clinicId,
        channel: c.channel,
        patientId: c.patient.id,
        externalId,
        contactFirstName: c.patient.name.split(" ")[1] ?? "",
        contactLastName: c.patient.name.split(" ")[0] ?? "",
        status: "OPEN",
        assignedToId: doctorUserId,
        unreadCount: c.unread,
        lastMessageAt: now,
        lastMessageText: c.lastMsg,
      },
    });
    // Seed a small thread
    for (let i = 0; i < 4; i++) {
      const direction = i % 2 === 0 ? "IN" : "OUT";
      await prisma.message.create({
        data: {
          clinicId,
          conversationId: convo.id,
          direction,
          body: direction === "IN"
            ? (i === 0 ? "Здравствуйте, доктор" : c.lastMsg)
            : "Здравствуйте! Слушаю вас.",
          senderId: direction === "OUT" ? doctorUserId : null,
          status: "SENT",
          createdAt: new Date(now.getTime() - (4 - i) * 60 * 1000),
        },
      });
    }
  }
  console.log(`[seed] Conversations: ${convoScripts.length}`);

  // ─── 9. Documents on past completed appointments ──────────────────────────
  const docScripts: Array<{ appt: typeof pastAppts[number]; type: "RESULT" | "PRESCRIPTION" | "REFERRAL"; title: string }> = [
    { appt: pastAppts[0]!, type: "RESULT", title: "Анализ крови (общий)" },
    { appt: pastAppts[0]!, type: "PRESCRIPTION", title: "Рецепт — Магне B6" },
    { appt: pastAppts[1]!, type: "RESULT", title: "ЭЭГ — заключение" },
    { appt: pastAppts[2]!, type: "REFERRAL", title: "Направление на МРТ" },
    { appt: pastAppts[3]!, type: "RESULT", title: "Биохимия крови" },
  ];
  for (const d of docScripts) {
    await prisma.document.create({
      data: {
        clinicId,
        patientId: d.appt.patientId,
        appointmentId: d.appt.id,
        type: d.type,
        title: `${QA_NOTE_TAG} ${d.title}`,
        fileUrl: `https://placehold.co/600x800/png?text=${encodeURIComponent(d.title)}`,
        mimeType: "image/png",
        sizeBytes: 51234,
        uploadedById: doctorUserId,
      },
    });
  }
  console.log(`[seed] Documents: ${docScripts.length}`);

  // ─── 10. DoctorNotificationPref (lazy upsert) ─────────────────────────────
  await prisma.doctorNotificationPref.upsert({
    where: { userId: doctorUserId },
    create: {
      userId: doctorUserId,
      labResultReceived_telegram: true, // toggled on to test the diff
    },
    update: {},
  });

  // ─── 11. Doctor.signatureUrl + bio ────────────────────────────────────────
  await prisma.doctor.update({
    where: { id: doctorId },
    data: {
      signatureUrl: "https://placehold.co/300x100/png?text=Signature",
      bioRu: doctor.nameRu + " — невролог высшей категории, стаж 15 лет. Специализируется на головных болях, расстройствах сна, мигренях.",
      bioUz: doctor.nameRu + " — oliy toifali nevrolog, 15 yil tajriba.",
    },
  });

  console.log("[seed] DONE.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
