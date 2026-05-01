/**
 * Demo data seeder — наполняет клинику NeuroFax кучей пациентов с
 * документами, записями и платежами, чтобы клиника выглядела как «в разгаре
 * работы». Идемпотентный — повторный запуск ничего не сломает (использует
 * uniqueBy phoneNormalized + помечает данные prefix-ом demo:).
 *
 * Запуск:
 *   npx tsx scripts/seed-demo-data.ts            # 80 пациентов
 *   PATIENTS=120 npx tsx scripts/seed-demo-data.ts
 *
 * Чистка (если нужно):
 *   CLEAN=1 npx tsx scripts/seed-demo-data.ts
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const SLUG = process.env.CLINIC_SLUG ?? "neurofax";
const PATIENTS = Number(process.env.PATIENTS ?? "150");
const CONVERSATIONS = Number(process.env.CONVERSATIONS ?? "18");
const CALLS = Number(process.env.CALLS ?? "30");
const LEADS = Number(process.env.LEADS ?? "16");
const CLEAN = process.env.CLEAN === "1";

const TAG = "demo:";

const FIRST_M = [
  "Алишер", "Бахтиёр", "Дилшод", "Жасур", "Зафар", "Илхом", "Камрон",
  "Лазиз", "Махмуд", "Нодир", "Олим", "Равшан", "Санжар", "Темур", "Улугбек",
  "Фарход", "Хусан", "Шохрух", "Эркин", "Юсуф", "Аббос", "Бекзод",
];
const FIRST_F = [
  "Азиза", "Барно", "Дилнора", "Гульнора", "Зухра", "Ирода", "Камола",
  "Лола", "Мадина", "Нилуфар", "Озода", "Раъно", "Сабина", "Тахмина",
  "Умида", "Феруза", "Хилола", "Шахноза", "Эльмира", "Юлдуз", "Анора",
];
const LAST_M = [
  "Каримов", "Усманов", "Юсупов", "Рахимов", "Мирзоев", "Турсунов",
  "Холматов", "Закиров", "Алиев", "Назаров", "Иброгимов", "Эрматов",
  "Жураев", "Махмудов", "Олимов", "Ражабов", "Содиков", "Ташпулатов",
  "Хасанов", "Шакиров",
];
const LAST_F = LAST_M.map((s) => s + "а");
const PATR_M = [
  "Алишерович", "Бахтиёрович", "Дилшодович", "Жасурович", "Икромович",
  "Камилович", "Махмудович", "Олимович", "Рустамович", "Шавкатович",
];
const PATR_F = PATR_M.map((s) => s.replace(/ович$/, "овна"));

const ADDRESSES = [
  "ул. Амира Темура, 12", "ул. Бабура, 45", "ул. Навои, 88",
  "массив Чиланзар, 7-23", "ул. Шахрисабз, 14", "ул. Алишера Навои, 56",
  "массив Юнусабад, 12-44", "ул. Мирабад, 3", "массив Мирзо Улугбек, 9-77",
];
const TG_USERS = [
  "alisher_k", "dilnora_m", "olim_jan", "lola_t", "saidakbar",
  "ferruza_n", "max_kar", "umida_x", undefined, undefined, undefined,
];
const SOURCES = [
  "WEBSITE", "TELEGRAM", "INSTAGRAM", "CALL", "WALKIN", "REFERRAL", "ADS",
] as const;
const SEGMENTS = ["NEW", "ACTIVE", "DORMANT", "VIP", "CHURN"] as const;

const DOC_TITLES_BY_TYPE: Record<string, string[]> = {
  REFERRAL: [
    "Направление от терапевта",
    "Направление на МРТ головного мозга",
    "Направление на консультацию невролога",
    "Направление на ЭЭГ",
  ],
  PRESCRIPTION: [
    "Рецепт — мильгамма",
    "Рецепт — мексидол",
    "Рецепт — глицин",
    "Рецепт — сирдалуд",
    "Рецепт по результату приёма",
  ],
  RESULT: [
    "Заключение МРТ",
    "Заключение ЭЭГ",
    "Анализы крови (общий)",
    "Заключение УЗИ сосудов шеи",
    "Заключение невролога",
  ],
  CONSENT: [
    "Согласие на обработку персональных данных",
    "Информированное согласие на процедуру",
  ],
  CONTRACT: [
    "Договор на оказание медицинских услуг",
  ],
  RECEIPT: [
    "Кассовый чек",
    "Квитанция об оплате",
  ],
  OTHER: [
    "Выписка из истории болезни",
    "Справка для работодателя",
  ],
};

const DOC_TYPES = [
  "REFERRAL",
  "PRESCRIPTION",
  "RESULT",
  "CONSENT",
  "CONTRACT",
  "RECEIPT",
  "OTHER",
] as const;

function pick<T>(arr: readonly T[], i?: number): T {
  return arr[(i ?? Math.floor(Math.random() * arr.length)) % arr.length]!;
}
function rndInt(lo: number, hi: number) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function pad(n: number) {
  return String(n).padStart(2, "0");
}
function birthDate(): Date {
  const year = rndInt(1955, 2008);
  const month = rndInt(0, 11);
  const day = rndInt(1, 28);
  return new Date(year, month, day);
}
function makePhone(seed: number): string {
  // +998 9X XXX XX XX — last 7 digits seeded so we can be deterministic-ish.
  const op = pick(["90", "91", "93", "94", "97", "99", "33", "88"], seed);
  const a = String(seed).padStart(7, "0").slice(-7);
  return `+998 ${op} ${a.slice(0, 3)} ${a.slice(3, 5)} ${a.slice(5, 7)}`;
}
function normalizePhone(p: string): string {
  return p.replace(/[^\d]/g, "");
}

/**
 * True if a non-cancelled appointment for the given doctor (or cabinet) already
 * overlaps the requested [startAt, endAt) slot. Mirrors the live API check in
 * `src/server/services/appointments.ts#detectConflicts` but inlined here so the
 * seed can run standalone without server module aliases.
 */
async function slotIsTaken(args: {
  doctorId: string;
  cabinetId: string | null;
  startAt: Date;
  endAt: Date;
}): Promise<boolean> {
  const where = {
    status: { notIn: ["CANCELLED", "NO_SHOW"] as ("CANCELLED" | "NO_SHOW")[] },
    date: { lt: args.endAt },
    endDate: { gt: args.startAt },
  };
  const doctorClash = await prisma.appointment.findFirst({
    where: { ...where, doctorId: args.doctorId },
    select: { id: true },
  });
  if (doctorClash) return true;
  if (args.cabinetId) {
    const cabClash = await prisma.appointment.findFirst({
      where: { ...where, cabinetId: args.cabinetId },
      select: { id: true },
    });
    if (cabClash) return true;
  }
  return false;
}

/**
 * Generates a tiny valid PDF (~600B) with a single line of Latin text. We use
 * the built-in Helvetica core font so no font embedding is needed — that lets
 * the file open in any browser PDF viewer for the demo. One file per
 * DocumentType is written to `public/uploads/demo/<type>.pdf` if it's not
 * already there.
 */
function buildPdf(label: string): Buffer {
  const content = `BT /F1 22 Tf 60 740 Td (NeuroFax demo) Tj 0 -34 Td /F1 16 Tf (${label}) Tj 0 -28 Td /F1 11 Tf (This is a placeholder file for demo purposes.) Tj ET`;
  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n");
  objects.push(
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
  );
  objects.push(
    `4 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj\n`,
  );
  objects.push(
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  );
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(Buffer.byteLength(body));
    body += o;
  }
  const xrefStart = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, "binary");
}

const DOC_TYPE_LABELS: Record<string, string> = {
  REFERRAL: "Referral / Napravlenie",
  PRESCRIPTION: "Prescription / Recept",
  RESULT: "Result / Zaklyuchenie",
  CONSENT: "Consent / Soglasie",
  CONTRACT: "Contract / Dogovor",
  RECEIPT: "Receipt / Chek",
  OTHER: "Other / Drugoe",
};

function ensureDemoFiles(): void {
  const dir = path.join(process.cwd(), "public", "uploads", "demo");
  fs.mkdirSync(dir, { recursive: true });
  for (const [type, label] of Object.entries(DOC_TYPE_LABELS)) {
    const file = path.join(dir, `${type.toLowerCase()}.pdf`);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, buildPdf(label));
    }
  }
}

function sampleFileUrl(type: string): string {
  return `/uploads/demo/${type.toLowerCase()}.pdf`;
}

async function main() {
  ensureDemoFiles();
  const clinic = await prisma.clinic.findFirst({
    where: { slug: SLUG },
    select: { id: true },
  });
  if (!clinic) {
    console.error(`clinic "${SLUG}" not found`);
    process.exit(1);
  }
  const clinicId = clinic.id;

  if (CLEAN) {
    // Wipe demo-tagged data only (idempotent reset).
    const demo = { tags: { has: TAG } };
    const apptIds = (
      await prisma.patient.findMany({
        where: { clinicId, ...demo },
        select: { appointments: { select: { id: true } } },
      })
    ).flatMap((p) => p.appointments.map((a) => a.id));
    if (apptIds.length > 0) {
      await prisma.appointmentService.deleteMany({
        where: { appointmentId: { in: apptIds } },
      });
      await prisma.payment.deleteMany({
        where: { OR: [{ appointmentId: { in: apptIds } }, { patient: { tags: { has: TAG } } }] },
      });
      await prisma.notificationSend.deleteMany({
        where: { appointmentId: { in: apptIds } },
      });
      await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
    }
    await prisma.document.deleteMany({
      where: { clinicId, patient: { tags: { has: TAG } } },
    });
    // Conversations / messages tagged with demo:.
    const convIds = (
      await prisma.conversation.findMany({
        where: {
          clinicId,
          OR: [
            { tags: { has: TAG } },
            { externalId: { startsWith: "demo-" } },
          ],
        },
        select: { id: true },
      })
    ).map((r) => r.id);
    if (convIds.length > 0) {
      await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
      await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
    }
    await prisma.call.deleteMany({
      where: { clinicId, sipCallId: { startsWith: "demo-" } },
    });
    await prisma.lead.deleteMany({
      where: { clinicId, comment: { startsWith: "[demo]" } },
    });
    const del = await prisma.patient.deleteMany({
      where: { clinicId, tags: { has: TAG } },
    });
    console.log(`cleaned ${del.count} demo patients + ${convIds.length} convs + dependents`);
    await prisma.$disconnect();
    return;
  }

  const [doctors, services, cabinets, recept] = await Promise.all([
    prisma.doctor.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, nameRu: true },
    }),
    prisma.service.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, nameRu: true, durationMin: true, priceBase: true },
    }),
    prisma.cabinet.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, number: true },
    }),
    prisma.user.findFirst({
      where: { clinicId, role: "RECEPTIONIST" },
      select: { id: true },
    }),
  ]);
  if (doctors.length === 0 || services.length === 0) {
    console.error("clinic missing doctors/services — seed core first");
    process.exit(1);
  }

  console.log(
    `clinic=${SLUG} doctors=${doctors.length} services=${services.length} cabinets=${cabinets.length}`,
  );

  // Backfill: previous runs of this seeder wrote per-row fileUrls like
  // `/uploads/demo/result-37.pdf` that never existed on disk. Repoint any
  // such rows to the shared per-type placeholder we just wrote.
  const stale = await prisma.document.findMany({
    where: {
      clinicId,
      fileUrl: { startsWith: "/uploads/demo/" },
      OR: DOC_TYPES.map((t) => ({
        fileUrl: { not: `/uploads/demo/${t.toLowerCase()}.pdf` },
      })),
    },
    select: { id: true, type: true },
  });
  if (stale.length > 0) {
    for (const row of stale) {
      await prisma.document.update({
        where: { id: row.id },
        data: { fileUrl: sampleFileUrl(row.type) },
      });
    }
    console.log(`repointed ${stale.length} stale demo documents to placeholders`);
  }

  console.log(`creating ${PATIENTS} demo patients with documents + bookings…`);

  let createdP = 0;
  let createdA = 0;
  let createdD = 0;
  let createdPay = 0;

  for (let i = 0; i < PATIENTS; i++) {
    const female = i % 2 === 0;
    const fn = pick(female ? FIRST_F : FIRST_M, i);
    const ln = pick(female ? LAST_F : LAST_M, i);
    const pa = pick(female ? PATR_F : PATR_M, i);
    const fullName = `${ln} ${fn} ${pa}`;
    const phone = makePhone(7000000 + i);
    const tgUsername = pick(TG_USERS, i);
    const segment = pick(SEGMENTS, i);
    const source = pick(SOURCES, i + 1);
    const tgId = i % 3 === 0 ? `${5_000_000 + i}` : null;

    // Idempotency via uniqueBy (clinicId, phoneNormalized).
    const patient = await prisma.patient.upsert({
      where: {
        clinicId_phoneNormalized: {
          clinicId,
          phoneNormalized: normalizePhone(phone),
        },
      },
      update: {},
      create: {
        clinicId,
        fullName,
        phone,
        phoneNormalized: normalizePhone(phone),
        birthDate: birthDate(),
        gender: female ? "FEMALE" : "MALE",
        address: pick(ADDRESSES, i),
        telegramId: tgId,
        telegramUsername: tgUsername ?? null,
        preferredChannel: tgId ? "TG" : "CALL",
        preferredLang: i % 4 === 0 ? "UZ" : "RU",
        source,
        segment,
        tags: [TAG, source.toLowerCase()],
        consentMarketing: i % 3 !== 0,
        ltv: 0,
        visitsCount: 0,
        balance: 0,
        notes: i % 5 === 0 ? "Аллергия на анальгетики." : null,
      },
      select: { id: true },
    });
    createdP++;

    // ─ Documents (1-3 per patient, varied types) ─────────────────────
    const docCount = rndInt(1, 3);
    for (let d = 0; d < docCount; d++) {
      const type = pick(DOC_TYPES, i + d);
      const titles = DOC_TITLES_BY_TYPE[type] ?? ["Документ"];
      const title = pick(titles, i + d);
      await prisma.document.create({
        data: {
          clinicId,
          patientId: patient.id,
          type,
          title,
          fileUrl: sampleFileUrl(type),
          mimeType: "application/pdf",
          sizeBytes: rndInt(40_000, 1_500_000),
          uploadedById: recept?.id ?? null,
        },
      });
      createdD++;
    }

    // ─ Appointments mix (past completed/no-show + today + future) ────
    // Past 1-3 records, today/near 0-1, future 0-1.
    const pastN = rndInt(1, 3);
    const futureN = rndInt(0, 1);
    let totalLtv = 0;
    let lastVisit: Date | null = null;
    for (let p = 0; p < pastN; p++) {
      const daysAgo = rndInt(2, 90);
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      const hour = rndInt(9, 17);
      const min = (rndInt(0, 1) === 0 ? 0 : 30);
      date.setHours(hour, min, 0, 0);
      const endDate = new Date(date.getTime() + 30 * 60_000);
      const svc = pick(services, i + p);
      const doc = pick(doctors, i + p);
      const cab = cabinets.length > 0 ? pick(cabinets, i + p) : null;
      const completed = Math.random() < 0.85;
      // Status NO_SHOW is treated as a freed slot by the overlap check, but
      // we still want to avoid stacking two real visits on one cabinet/doctor.
      if (
        completed &&
        (await slotIsTaken({
          doctorId: doc.id,
          cabinetId: cab?.id ?? null,
          startAt: date,
          endAt: endDate,
        }))
      ) {
        continue;
      }
      const appt = await prisma.appointment.create({
        data: {
          clinicId,
          patientId: patient.id,
          doctorId: doc.id,
          cabinetId: cab?.id ?? null,
          serviceId: svc.id,
          date,
          time: `${pad(hour)}:${pad(min)}`,
          durationMin: svc.durationMin,
          endDate,
          status: completed ? "COMPLETED" : "NO_SHOW",
          queueStatus: completed ? "COMPLETED" : "NO_SHOW",
          channel: pick(["WALKIN", "PHONE", "TELEGRAM", "WEBSITE"], i + p) as
            | "WALKIN"
            | "PHONE"
            | "TELEGRAM"
            | "WEBSITE",
          priceService: svc.priceBase,
          priceBase: svc.priceBase,
          priceFinal: svc.priceBase,
          completedAt: completed ? date : null,
          createdById: recept?.id ?? null,
        },
      });
      createdA++;
      if (completed) {
        totalLtv += svc.priceBase;
        if (!lastVisit || date > lastVisit) lastVisit = date;
        // Payment in 90% of completed visits.
        if (Math.random() < 0.9) {
          await prisma.payment.create({
            data: {
              clinicId,
              appointmentId: appt.id,
              patientId: patient.id,
              currency: "UZS",
              amount: svc.priceBase,
              method: pick(["CASH", "CARD", "PAYME", "CLICK", "UZUM"], i + p) as
                | "CASH"
                | "CARD"
                | "PAYME"
                | "CLICK"
                | "UZUM",
              status: "PAID",
              paidAt: date,
            },
          });
          createdPay++;
        }
      }
    }
    // Future booking — try 1-3 times to find a free slot.
    for (let f = 0; f < futureN; f++) {
      const daysAhead = rndInt(1, 14);
      const date = new Date();
      date.setDate(date.getDate() + daysAhead);
      const hour = rndInt(9, 17);
      const min = rndInt(0, 1) === 0 ? 0 : 30;
      date.setHours(hour, min, 0, 0);
      const endDate = new Date(date.getTime() + 30 * 60_000);
      const svc = pick(services, i + f + 5);
      const doc = pick(doctors, i + f + 5);
      if (
        await slotIsTaken({
          doctorId: doc.id,
          cabinetId: null,
          startAt: date,
          endAt: endDate,
        })
      ) {
        continue;
      }
      await prisma.appointment.create({
        data: {
          clinicId,
          patientId: patient.id,
          doctorId: doc.id,
          serviceId: svc.id,
          date,
          time: `${pad(hour)}:${pad(min)}`,
          durationMin: svc.durationMin,
          endDate,
          status: "BOOKED",
          queueStatus: "BOOKED",
          channel: pick(["WALKIN", "PHONE", "TELEGRAM"], i + f) as
            | "WALKIN"
            | "PHONE"
            | "TELEGRAM",
          priceService: svc.priceBase,
          priceBase: svc.priceBase,
          priceFinal: svc.priceBase,
          createdById: recept?.id ?? null,
        },
      });
      createdA++;
    }

    if (totalLtv > 0 || lastVisit) {
      await prisma.patient.update({
        where: { id: patient.id },
        data: {
          ltv: totalLtv,
          visitsCount: pastN,
          lastVisitAt: lastVisit,
        },
      });
    }
  }

  // ── Stress-test cleanup ─────────────────────────────────────────
  // Earlier stress runs left "Stress Patient #N" + a "STRESS-XXXX" cabinet
  // hanging around. Wipe them so the demo dashboard is clean.
  const stressDeleted = await cleanupStressLeftovers(clinicId);

  // ── Today's storyline ───────────────────────────────────────────
  // Drive off real DoctorSchedule + ServiceOnDoctor: each anchored
  // doctor fills their cabinet within their working window, picking
  // only services they actually perform.
  const demoPatients = await prisma.patient.findMany({
    where: { clinicId, tags: { has: TAG } },
    select: { id: true, fullName: true },
  });
  const story = await rebuildTodayStoryline({
    clinicId,
    services,
    patients: demoPatients,
    receptId: recept?.id ?? null,
  });

  // ── Communications: Conversations + Messages ─────────────────────
  const conv = await rebuildConversations({
    clinicId,
    patients: demoPatients,
    receptId: recept?.id ?? null,
  });

  // ── Calls (Call Center journal) ──────────────────────────────────
  const callStats = await rebuildCalls({
    clinicId,
    patients: demoPatients,
    receptId: recept?.id ?? null,
  });

  // ── Leads (online requests / follow-ups for call-center) ─────────
  const leadStats = await rebuildLeads({
    clinicId,
    doctors,
  });

  console.log("");
  console.log("✅ done");
  console.log(`  patients      +${createdP}`);
  console.log(`  documents     +${createdD}`);
  console.log(`  appointmts    +${createdA} (history) + ${story.created} (today)`);
  console.log(`  payments      +${createdPay}`);
  console.log(
    `  today storyline: ${story.completed} completed · ${story.inProgress} in chair · ${story.waiting} waiting · ${story.booked} upcoming · ${story.noShow} no-show · ${story.cancelled} cancelled`,
  );
  console.log(
    `  payments      ${story.completed - story.unpaid - story.discounted} paid full · ${story.discounted} discounted · ${story.unpaid} unpaid`,
  );
  console.log(
    `  conversations ${conv.created} (${conv.tg} TG · ${conv.sms} SMS · ${conv.unread} unread)`,
  );
  console.log(
    `  calls         ${callStats.created} (${callStats.incoming} IN · ${callStats.outgoing} OUT · ${callStats.missed} missed)`,
  );
  console.log(
    `  leads         ${leadStats.created} (${leadStats.new} new · ${leadStats.contacted} contacted)`,
  );
  if (stressDeleted > 0) console.log(`  cleaned       ${stressDeleted} stress leftovers`);
  await prisma.$disconnect();
}

const TG_USERNAMES_FULL = [
  { username: "alisher_dev", first: "Алишер", last: "Каримов" },
  { username: "dilnora_m", first: "Дилнора", last: "Махмудова" },
  { username: "olim_jan", first: "Олим", last: "Усманов" },
  { username: "lola_t", first: "Лола", last: "Турсунова" },
  { username: "saidakbar_n", first: "Саидакбар", last: "Назаров" },
  { username: "ferruza_n", first: "Феруза", last: "Назарова" },
  { username: "max_kar", first: "Максуд", last: "Каримов" },
  { username: "umida_x", first: "Умида", last: "Холматова" },
  { username: "sherali_b", first: "Шерали", last: "Бабаджанов" },
  { username: "nigora_s", first: "Нигора", last: "Содикова" },
  { username: "ravshan_m", first: "Равшан", last: "Мирзоев" },
  { username: "kamola_y", first: "Камола", last: "Юсупова" },
];

const TG_INBOUND_TEMPLATES = [
  "Здравствуйте, можно записаться на МРТ?",
  "Какие анализы нужно сдать перед приёмом невролога?",
  "Подскажите расписание Ахмедова на эту неделю",
  "Здравствуйте, у меня болит голова уже неделю, к кому записаться?",
  "Сколько стоит ЭЭГ?",
  "Можно перенести запись с завтра на пятницу?",
  "Здравствуйте, я опаздываю на 15 минут, можно?",
  "Где находится клиника? Удобный ориентир?",
  "Doktor bilan onlayn konsultatsiya bormi?",
  "Bola uchun nevrologga yozilsam bo‘ladimi?",
  "Спасибо за приём, всё прошло отлично",
  "Можно получить заключение на электронную почту?",
];

const TG_OUTBOUND_TEMPLATES = [
  "Здравствуйте! Да, конечно. На какое время вам удобно?",
  "Анализов специальных не нужно. Возьмите паспорт и старые заключения, если есть.",
  "На этой неделе доктор принимает Пн/Ср/Пт с 09:00 до 13:00.",
  "Записал вас на пятницу в 14:30. Жду подтверждения 🙌",
  "Стоимость ЭЭГ — 320 000 сум, длительность 30 минут.",
  "Конечно, перенёс на пятницу в 11:00. Хорошего дня!",
  "Не переживайте, ждём вас. Можем чуть подвинуть начало.",
  "Адрес: г. Ташкент, ул. Бабура 12. Ориентир — рядом с метро Чиланзар.",
  "Ha, onlayn konsultatsiya bor. Vaqt belgilaymi?",
  "Albatta, bolangiz uchun pediatr-nevrolog Karimovaga yozaman.",
  "Спасибо вам! Будем рады видеть снова 🌷",
  "Да, отправили на ваш email. Если не пришло — проверьте «спам».",
];

const SMS_INBOUND_TEMPLATES = [
  "Здравствуйте, перенесите запись на 16:00",
  "Подтверждаю запись",
  "ОТМЕНА",
  "Спасибо",
];

async function rebuildConversations(args: {
  clinicId: string;
  patients: { id: string; fullName: string }[];
  receptId: string | null;
}): Promise<{ created: number; tg: number; sms: number; unread: number }> {
  const { clinicId, patients, receptId } = args;
  // Wipe demo conversations (anything tagged "demo:" or with our externalId
  // prefix) so re-runs are idempotent.
  const stale = await prisma.conversation.findMany({
    where: {
      clinicId,
      OR: [
        { tags: { has: TAG } },
        { externalId: { startsWith: "demo-" } },
      ],
    },
    select: { id: true },
  });
  if (stale.length > 0) {
    const ids = stale.map((c) => c.id);
    await prisma.message.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  }

  if (CONVERSATIONS === 0 || patients.length === 0) {
    return { created: 0, tg: 0, sms: 0, unread: 0 };
  }

  const now = Date.now();
  let created = 0,
    tg = 0,
    sms = 0,
    unread = 0;

  // ~70% TG, 30% SMS
  for (let i = 0; i < CONVERSATIONS; i++) {
    const isTg = i % 10 < 7;
    const channel = isTg ? "TG" : "SMS";
    const ageMin = rndInt(2, 60 * 24 * 3); // 2 minutes to 3 days
    const lastMessageAt = new Date(now - ageMin * 60_000);
    const tgPerson = TG_USERNAMES_FULL[i % TG_USERNAMES_FULL.length]!;
    const linkedPatient = i % 3 === 0 ? null : patients[i % patients.length]!;
    const isUnread = i % 3 !== 1; // ~66% unread
    const status = i % 9 === 8 ? "SNOOZED" : "OPEN";
    const inboundCount = rndInt(1, 3);
    const outboundCount = isUnread ? rndInt(0, 1) : rndInt(1, 2);
    const totalMsg = inboundCount + outboundCount;
    const lastInbound =
      SMS_INBOUND_TEMPLATES[i % SMS_INBOUND_TEMPLATES.length]!;
    const tgInbound = TG_INBOUND_TEMPLATES[i % TG_INBOUND_TEMPLATES.length]!;
    const lastText = isTg ? tgInbound : lastInbound;

    const externalId = `demo-${channel.toLowerCase()}-${i}`;
    const conv = await prisma.conversation.create({
      data: {
        clinicId,
        channel: channel as "TG" | "SMS",
        mode: "bot",
        patientId: linkedPatient?.id ?? null,
        externalId,
        contactFirstName: isTg
          ? tgPerson.first
          : linkedPatient?.fullName.split(" ")[1] ?? null,
        contactLastName: isTg
          ? tgPerson.last
          : linkedPatient?.fullName.split(" ")[0] ?? null,
        contactUsername: isTg ? tgPerson.username : null,
        status: status as "OPEN" | "SNOOZED",
        assignedToId: i % 4 === 0 ? receptId : null,
        tags: [TAG],
        lastMessageAt,
        lastMessageText: lastText.slice(0, 140),
        unreadCount: isUnread ? rndInt(1, 3) : 0,
      },
    });

    // Build a short conversation thread (oldest first).
    const threadStart = lastMessageAt.getTime() - totalMsg * 90_000;
    let msgIdx = 0;
    for (let m = 0; m < inboundCount; m++) {
      const t = new Date(threadStart + msgIdx * 90_000);
      msgIdx++;
      await prisma.message.create({
        data: {
          clinicId,
          conversationId: conv.id,
          direction: "IN",
          body: isTg
            ? TG_INBOUND_TEMPLATES[(i + m) % TG_INBOUND_TEMPLATES.length]!
            : SMS_INBOUND_TEMPLATES[(i + m) % SMS_INBOUND_TEMPLATES.length]!,
          status: "DELIVERED",
          externalId: `demo-msg-${i}-in-${m}`,
          createdAt: t,
        },
      });
    }
    for (let m = 0; m < outboundCount; m++) {
      const t = new Date(threadStart + msgIdx * 90_000);
      msgIdx++;
      await prisma.message.create({
        data: {
          clinicId,
          conversationId: conv.id,
          direction: "OUT",
          body: isTg
            ? TG_OUTBOUND_TEMPLATES[(i + m) % TG_OUTBOUND_TEMPLATES.length]!
            : "Запись подтверждена. Ждём вас!",
          senderId: receptId,
          status: "READ",
          externalId: `demo-msg-${i}-out-${m}`,
          createdAt: t,
        },
      });
    }

    created++;
    if (isTg) tg++;
    else sms++;
    if (isUnread) unread++;
  }

  return { created, tg, sms, unread };
}

const CALL_SUMMARIES = [
  "Запись на консультацию невролога",
  "Уточнение цены МРТ",
  "Перенос записи на другой день",
  "Вопрос о результатах анализов",
  "Подтверждение записи",
  "Жалоба на головную боль — записан к неврологу",
  "Запись ребёнка к педиатру",
  "Уточнение адреса клиники",
  "Запрос на повторный приём",
  "Отмена записи по болезни",
];

async function rebuildCalls(args: {
  clinicId: string;
  patients: { id: string; fullName: string }[];
  receptId: string | null;
}): Promise<{
  created: number;
  incoming: number;
  outgoing: number;
  missed: number;
}> {
  const { clinicId, patients, receptId } = args;

  // Wipe demo calls (sipCallId starting with demo-).
  await prisma.call.deleteMany({
    where: { clinicId, sipCallId: { startsWith: "demo-" } },
  });

  if (CALLS === 0) return { created: 0, incoming: 0, outgoing: 0, missed: 0 };
  const clinicPhone = "+998 71 234 5678";
  const now = Date.now();
  let created = 0,
    incoming = 0,
    outgoing = 0,
    missed = 0;

  for (let i = 0; i < CALLS; i++) {
    // Direction mix: 60% IN, 25% OUT, 15% MISSED.
    const r = (i * 7) % 20;
    const direction =
      r < 12 ? "IN" : r < 17 ? "OUT" : "MISSED";
    const ageMin =
      i < 5 ? rndInt(1, 90) : rndInt(120, 60 * 24 * 5); // first 5 are recent, rest older
    const createdAt = new Date(now - ageMin * 60_000);
    const linkedPatient = i % 3 !== 0 ? patients[i % patients.length] : null;
    const fromNumber =
      direction === "IN" || direction === "MISSED"
        ? makePhone(8_000_000 + i)
        : clinicPhone;
    const toNumber =
      direction === "OUT" ? makePhone(8_000_000 + i) : clinicPhone;
    const durationSec =
      direction === "MISSED" ? null : rndInt(35, 320);
    const endedAt =
      direction === "MISSED"
        ? null
        : new Date(createdAt.getTime() + (durationSec ?? 0) * 1000);
    const summary =
      direction === "MISSED"
        ? null
        : CALL_SUMMARIES[i % CALL_SUMMARIES.length]!;
    await prisma.call.create({
      data: {
        clinicId,
        direction: direction as "IN" | "OUT" | "MISSED",
        fromNumber,
        toNumber,
        patientId: linkedPatient?.id ?? null,
        operatorId: direction === "MISSED" ? null : receptId,
        durationSec,
        summary,
        tags: [TAG],
        sipCallId: `demo-call-${i}`,
        createdAt,
        endedAt,
      },
    });
    created++;
    if (direction === "IN") incoming++;
    else if (direction === "OUT") outgoing++;
    else missed++;
  }
  return { created, incoming, outgoing, missed };
}

const LEAD_NAMES = [
  "Анна Петрова",
  "Дилшод Холматов",
  "Сергей Иванов",
  "Зухра Каримова",
  "Madina Yusupova",
  "Алексей Морозов",
  "Феруза Алиева",
  "Бахтиёр Усманов",
  "Ольга Соколова",
  "Жасур Назаров",
  "Лола Махмудова",
  "Максим Захаров",
  "Нилуфар Турсунова",
  "Илхом Рахимов",
  "Татьяна Беляева",
  "Шерали Юсупов",
];
const LEAD_SERVICES = [
  "Консультация невролога",
  "МРТ головного мозга",
  "ЭЭГ",
  "УЗИ сосудов шеи",
  "Консультация педиатра-невролога",
  "Кардиолог",
  "Повторный приём",
];
const LEAD_COMMENTS = [
  "Хочет записаться на эту неделю",
  "Перезвонить после 18:00",
  "Просит уточнить цену",
  "Привезёт результаты прошлых обследований",
  "Будет с ребёнком 7 лет",
  "Аллергия на пенициллин — отметили",
  null,
  null,
];

async function rebuildLeads(args: {
  clinicId: string;
  doctors: { id: string; nameRu: string }[];
}): Promise<{ created: number; new: number; contacted: number }> {
  const { clinicId, doctors } = args;

  await prisma.lead.deleteMany({
    where: { clinicId, comment: { startsWith: "[demo]" } },
  });

  if (LEADS === 0) return { created: 0, new: 0, contacted: 0 };
  const sources = ["WEBSITE", "TELEGRAM", "INSTAGRAM", "CALL", "REFERRAL"] as const;
  const now = Date.now();
  let created = 0,
    newCount = 0,
    contacted = 0;

  for (let i = 0; i < LEADS; i++) {
    // Status mix: 60% NEW, 25% CONTACTED, 10% CONVERTED, 5% CANCELLED
    const r = (i * 5) % 20;
    const status =
      r < 12
        ? "NEW"
        : r < 17
        ? "CONTACTED"
        : r < 19
        ? "CONVERTED"
        : "CANCELLED";
    const ageHours = rndInt(1, 96);
    const createdAt = new Date(now - ageHours * 3_600_000);
    const wantedDate =
      i % 4 === 0
        ? null
        : new Date(now + rndInt(1, 14) * 24 * 3_600_000);
    const doctor = i % 3 === 0 ? null : doctors[i % doctors.length]!;
    await prisma.lead.create({
      data: {
        clinicId,
        name: LEAD_NAMES[i % LEAD_NAMES.length]!,
        phone: makePhone(9_000_000 + i),
        service: LEAD_SERVICES[i % LEAD_SERVICES.length]!,
        date: wantedDate,
        doctorId: doctor?.id ?? null,
        status: status as "NEW" | "CONTACTED" | "CONVERTED" | "CANCELLED",
        source: sources[i % sources.length]!,
        comment: `[demo] ${LEAD_COMMENTS[i % LEAD_COMMENTS.length] ?? "Заявка с сайта"}`,
        createdAt,
      },
    });
    created++;
    if (status === "NEW") newCount++;
    else if (status === "CONTACTED") contacted++;
  }
  return { created, new: newCount, contacted };
}

/**
 * Wipe leftovers from `scripts/stress-appointments.ts` runs (Stress Patient
 * #N, "STRESS-####" cabinet, their appointments + payments). Idempotent.
 */
async function cleanupStressLeftovers(clinicId: string): Promise<number> {
  const stressPatients = await prisma.patient.findMany({
    where: { clinicId, fullName: { startsWith: "Stress Patient" } },
    select: { id: true },
  });
  const stressCabinets = await prisma.cabinet.findMany({
    where: { clinicId, number: { startsWith: "STRESS" } },
    select: { id: true },
  });
  const ids = stressPatients.map((p) => p.id);
  const cabIds = stressCabinets.map((c) => c.id);
  const apptIds = (
    await prisma.appointment.findMany({
      where: {
        clinicId,
        OR: [
          ...(ids.length > 0 ? [{ patientId: { in: ids } }] : []),
          ...(cabIds.length > 0 ? [{ cabinetId: { in: cabIds } }] : []),
        ],
      },
      select: { id: true },
    })
  ).map((r) => r.id);
  if (apptIds.length > 0) {
    await prisma.appointmentService.deleteMany({
      where: { appointmentId: { in: apptIds } },
    });
    await prisma.payment.deleteMany({
      where: { appointmentId: { in: apptIds } },
    });
    await prisma.notificationSend.deleteMany({
      where: { appointmentId: { in: apptIds } },
    });
    await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
  }
  if (ids.length > 0) {
    await prisma.payment.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.document.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.patient.deleteMany({ where: { id: { in: ids } } });
  }
  if (cabIds.length > 0) {
    await prisma.cabinet.deleteMany({ where: { id: { in: cabIds } } });
  }
  return ids.length + cabIds.length;
}

/**
 * Rebuild today's appointment storyline so the reception dashboard always
 * shows a "live" clinic regardless of the wall clock at demo time.
 *
 * Strategy: per cabinet, pick a doctor + a service "specialty" and lay
 * down 30-min slots from 09:00 to 19:00. Each slot's status is derived
 * from the current time:
 *   slot.endAt   <= now            → COMPLETED + Payment (PAID)
 *   slot.startAt <= now < end      → IN_PROGRESS, calledAt + startedAt set
 *   slot.startAt - 30m <= now      → WAITING, calledAt set (in queue)
 *   else                           → BOOKED
 *
 * Re-runnable: deletes today's appointments tied to demo patients before
 * inserting fresh ones, so the dashboard stays in sync with `now`.
 */
const APPT_NOTES_POOL = [
  "Аллергия на пенициллин — отметили в карте",
  "Опаздывает, предупредил по телефону",
  "Нужен переводчик с узбекского",
  "Повторный приём после МРТ",
  "Просит распечатать заключение",
  "Записан срочно, направление от терапевта",
  "Беременность 18 нед — учесть при назначениях",
  "Пришёл с сопровождающим",
  "Хочет получить заключение на email",
  "Жалуется на бессонницу",
];

const CANCEL_REASONS = [
  "Пациент перенёс на другой день",
  "Заболел сам пациент",
  "Не дозвонились для подтверждения",
  "Доктор перенёс смену",
];

/**
 * Pick a service whose duration is closest to a target. Returns the
 * service + its actual duration (which may differ from target if the
 * clinic doesn't have a service of exactly that length).
 */
function pickServiceByDuration(
  services: { id: string; durationMin: number; priceBase: number }[],
  targetMin: number,
  seed: number,
): { id: string; durationMin: number; priceBase: number } {
  // Group services by closeness to target.
  const sorted = [...services].sort(
    (a, b) =>
      Math.abs(a.durationMin - targetMin) - Math.abs(b.durationMin - targetMin),
  );
  // Return one of the top-3 closest, picked by seed for variety.
  const top = sorted.slice(0, Math.min(3, sorted.length));
  return top[seed % top.length]!;
}

/**
 * Realistic full-day storyline driven by DoctorSchedule + ServiceOnDoctor:
 * each anchored (cabinetId set) doctor fills their cabinet within their
 * actual working window, picking only services they perform. Status mix
 * (COMPLETED 86% / NO_SHOW 8% / CANCELLED 6% in the past, IN_PROGRESS now,
 * WAITING for next-25min, BOOKED ahead), payment mix (paid full / discount /
 * unpaid), walk-in extras without a cabinet. Targets ≥200 appointments per
 * day for the real NEUROFAX-B lineup.
 */
async function rebuildTodayStoryline(args: {
  clinicId: string;
  services: { id: string; nameRu: string; durationMin: number; priceBase: number }[];
  patients: { id: string; fullName: string }[];
  receptId: string | null;
}): Promise<{
  created: number;
  completed: number;
  inProgress: number;
  waiting: number;
  booked: number;
  noShow: number;
  cancelled: number;
  unpaid: number;
  discounted: number;
}> {
  const { clinicId, services, patients, receptId } = args;
  const empty = {
    created: 0,
    completed: 0,
    inProgress: 0,
    waiting: 0,
    booked: 0,
    noShow: 0,
    cancelled: 0,
    unpaid: 0,
    discounted: 0,
  };
  if (services.length === 0 || patients.length === 0) {
    return empty;
  }

  // Today's weekday (0=Sun..6=Sat). If today is Sunday and no schedule
  // exists, fall back to Monday so the boss-demo always has data.
  const todayWeekday = new Date().getDay();
  // Cabinet is bound to doctor (Phase 11); pull it via doctor.cabinet rather
  // than DoctorSchedule.cabinetId (which no longer exists).
  type DemoSchedule = {
    doctorId: string;
    cabinetId: string;
    startTime: string;
    endTime: string;
    doctor: { id: string; nameRu: string };
    cabinet: { id: string; number: string } | null;
  };
  const fetchSchedules = async (weekday: number): Promise<DemoSchedule[]> => {
    const rows = await prisma.doctorSchedule.findMany({
      where: {
        clinicId,
        isActive: true,
        weekday,
        doctor: { isActive: true, cabinet: { isActive: true } },
      },
      select: {
        doctorId: true,
        startTime: true,
        endTime: true,
        doctor: {
          select: {
            id: true,
            nameRu: true,
            cabinetId: true,
            cabinet: { select: { id: true, number: true, isActive: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      doctorId: r.doctorId,
      cabinetId: r.doctor.cabinetId,
      startTime: r.startTime,
      endTime: r.endTime,
      doctor: { id: r.doctor.id, nameRu: r.doctor.nameRu },
      cabinet: r.doctor.cabinet
        ? { id: r.doctor.cabinet.id, number: r.doctor.cabinet.number }
        : null,
    }));
  };

  let schedules = await fetchSchedules(todayWeekday);
  if (schedules.length === 0) {
    // Mon fallback so demo always has data even if run on Sunday.
    schedules = await fetchSchedules(1);
  }
  if (schedules.length === 0) return empty;

  const cabinetById = new Map(
    schedules
      .map((s) => s.cabinet)
      .filter((c): c is { id: string; number: string } => !!c)
      .map((c) => [c.id, c]),
  );

  // Per-doctor allowed services + price overrides.
  const doctorIds = Array.from(new Set(schedules.map((s) => s.doctorId)));
  const links = await prisma.serviceOnDoctor.findMany({
    where: { doctorId: { in: doctorIds } },
    select: { doctorId: true, serviceId: true, priceOverride: true },
  });
  const allowedByDoctor = new Map<string, Set<string>>();
  const overrideByPair = new Map<string, number>(); // `${doctorId}|${serviceId}` → price
  for (const l of links) {
    if (!allowedByDoctor.has(l.doctorId)) {
      allowedByDoctor.set(l.doctorId, new Set());
    }
    allowedByDoctor.get(l.doctorId)!.add(l.serviceId);
    if (l.priceOverride != null) {
      overrideByPair.set(`${l.doctorId}|${l.serviceId}`, l.priceOverride);
    }
  }
  const servicesById = new Map(services.map((s) => [s.id, s]));
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Wipe today's appointments tied to demo patients so we can rebuild a
  // fresh storyline aligned with the current wall clock.
  const todays = await prisma.appointment.findMany({
    where: {
      clinicId,
      date: { gte: dayStart, lt: dayEnd },
      patient: { tags: { has: TAG } },
    },
    select: { id: true },
  });
  const todayIds = todays.map((r) => r.id);
  if (todayIds.length > 0) {
    await prisma.appointmentService.deleteMany({
      where: { appointmentId: { in: todayIds } },
    });
    await prisma.payment.deleteMany({
      where: { appointmentId: { in: todayIds } },
    });
    await prisma.notificationSend.deleteMany({
      where: { appointmentId: { in: todayIds } },
    });
    await prisma.appointment.deleteMany({ where: { id: { in: todayIds } } });
  }

  const now = new Date();
  const stats = { ...empty };
  let queueOrder = 0;
  let patientCursor = 0;
  const channelWeights: { v: "WALKIN" | "PHONE" | "TELEGRAM" | "WEBSITE" | "KIOSK"; w: number }[] = [
    { v: "WALKIN", w: 25 },
    { v: "PHONE", w: 30 },
    { v: "TELEGRAM", w: 25 },
    { v: "WEBSITE", w: 15 },
    { v: "KIOSK", w: 5 },
  ];
  const channelCum: { v: typeof channelWeights[number]["v"]; cum: number }[] = [];
  let cAcc = 0;
  for (const c of channelWeights) {
    cAcc += c.w;
    channelCum.push({ v: c.v, cum: cAcc });
  }
  const pickChannel = (seed: number) => {
    const r = seed % 100;
    return channelCum.find((c) => r < c.cum)!.v;
  };
  const payMethods = ["CASH", "CARD", "PAYME", "CLICK", "UZUM"] as const;

  // Duration weights (in minutes) — average ~26 min per appointment.
  const durationPool: { d: number; cum: number }[] = [];
  let dAcc = 0;
  for (const [d, w] of [[15, 50], [30, 30], [45, 15], [60, 5]] as const) {
    dAcc += w;
    durationPool.push({ d, cum: dAcc });
  }
  const pickDuration = (seed: number) => {
    const r = seed % 100;
    return durationPool.find((p) => r < p.cum)!.d;
  };

  // Each schedule entry = one doctor anchored to one cabinet for a
  // contiguous time window. Fill the window respecting that doctor's
  // ServiceOnDoctor list; pricing falls back from priceOverride to base.
  const parseHHMM = (s: string): number => {
    const [h, m] = s.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  for (let sIdx = 0; sIdx < schedules.length; sIdx++) {
    const sch = schedules[sIdx]!;
    if (!sch.cabinetId) continue;
    const cab = cabinetById.get(sch.cabinetId);
    if (!cab) continue;
    const doctor = sch.doctor;
    const allowed = allowedByDoctor.get(doctor.id);
    if (!allowed || allowed.size === 0) continue;
    const doctorServices = services.filter((s) => allowed.has(s.id));
    if (doctorServices.length === 0) continue;

    const winStart = parseHHMM(sch.startTime);
    const winEnd = parseHHMM(sch.endTime);
    let cursorMin = winStart;
    let lunchTaken = false;
    while (cursorMin + 15 <= winEnd) {
      // Lunch break (approx 13:00-14:00) — once per schedule, ~80% of cabs,
      // only if the window crosses lunch.
      if (
        !lunchTaken &&
        cursorMin >= 13 * 60 &&
        cursorMin < 14 * 60 &&
        winEnd > 14 * 60 &&
        (sIdx % 5) !== 0
      ) {
        cursorMin = 14 * 60;
        lunchTaken = true;
        continue;
      }
      const seed = sIdx * 1000 + cursorMin;
      const targetDur = pickDuration(seed * 7 + sIdx);
      const svc = pickServiceByDuration(doctorServices, targetDur, seed);
      const dur = svc.durationMin;
      if (cursorMin + dur > winEnd) break;

      // 6% gap: clinic is between patients (administrative).
      if (seed % 17 === 0) {
        cursorMin += 15;
        continue;
      }

      const startAt = new Date(dayStart);
      startAt.setMinutes(cursorMin);
      const endAt = new Date(startAt.getTime() + dur * 60_000);
      const priceBase =
        overrideByPair.get(`${doctor.id}|${svc.id}`) ?? svc.priceBase;

      // Status assignment based on time + realistic mix for past slots.
      let status: "COMPLETED" | "IN_PROGRESS" | "WAITING" | "BOOKED" | "NO_SHOW" | "CANCELLED";
      const beforeWaiting = new Date(startAt.getTime() - 25 * 60_000);
      // Stronger mixer so the distribution is actually uniform across seeds.
      const mix = (seed * 2654435761) >>> 0;
      if (endAt <= now) {
        const r = mix % 100;
        if (r < 86) status = "COMPLETED";
        else if (r < 94) status = "NO_SHOW";
        else status = "CANCELLED";
      } else if (startAt <= now && now < endAt) {
        status = "IN_PROGRESS";
      } else if (beforeWaiting <= now) {
        // Only ~70% of soon-to-start patients have arrived; the rest are
        // still BOOKED (en-route).
        status = (mix % 10) < 7 ? "WAITING" : "BOOKED";
      } else {
        status = "BOOKED";
      }

      const patient = patients[patientCursor % patients.length]!;
      patientCursor += 1;
      const channel = pickChannel(seed);

      // Discount: 12% of completed get 5-25% off.
      const discountPct =
        status === "COMPLETED" && seed % 8 === 0
          ? 5 + ((seed * 13) % 21) // 5..25
          : 0;
      const discountAmount = Math.round((priceBase * discountPct) / 100);
      const priceFinal = priceBase - discountAmount;

      const note = seed % 7 === 0 ? APPT_NOTES_POOL[seed % APPT_NOTES_POOL.length]! : null;
      const cancelReason =
        status === "CANCELLED" ? CANCEL_REASONS[seed % CANCEL_REASONS.length]! : null;

      const data: Record<string, unknown> = {
        clinicId,
        patientId: patient.id,
        doctorId: doctor.id,
        cabinetId: cab.id,
        serviceId: svc.id,
        date: startAt,
        time: `${pad(startAt.getHours())}:${pad(startAt.getMinutes())}`,
        durationMin: dur,
        endDate: endAt,
        status,
        queueStatus: status,
        channel,
        priceService: priceBase,
        priceBase,
        discountPct,
        discountAmount,
        priceFinal,
        createdById: receptId,
        notes: note,
        comments: null,
        cancelReason,
      };
      if (status === "WAITING") {
        data.calledAt = new Date(now.getTime() - 6 * 60_000);
        data.queueOrder = ++queueOrder;
      } else if (status === "IN_PROGRESS") {
        data.calledAt = new Date(startAt.getTime() - 5 * 60_000);
        data.startedAt = startAt;
      } else if (status === "COMPLETED") {
        data.calledAt = new Date(startAt.getTime() - 5 * 60_000);
        data.startedAt = startAt;
        data.completedAt = endAt;
      } else if (status === "CANCELLED") {
        data.cancelledAt = new Date(startAt.getTime() - 30 * 60_000);
      }

      // Skip if a previous schedule (or earlier iteration) already booked
      // the same doctor/cabinet across this slot. Without this the calendar
      // shows visible overbookings on overlapping doctor schedules.
      if (
        await slotIsTaken({
          doctorId: doctor.id,
          cabinetId: cab.id,
          startAt,
          endAt,
        })
      ) {
        cursorMin += dur;
        continue;
      }
      try {
        const appt = await prisma.appointment.create({ data: data as never });
        stats.created++;
        if (status === "COMPLETED") {
          stats.completed++;
          // Payment mix: 80% paid full, 12% paid with discount (already
          // computed), 8% unpaid (no Payment row → "ожидает оплаты" в кассе).
          const payRoll = (seed * 19) % 100;
          if (payRoll < 92) {
            await prisma.payment.create({
              data: {
                clinicId,
                appointmentId: appt.id,
                patientId: patient.id,
                currency: "UZS",
                amount: priceFinal,
                method: payMethods[(seed * 3) % payMethods.length]!,
                status: "PAID",
                paidAt: endAt,
              },
            });
            if (discountPct > 0) stats.discounted++;
          } else {
            stats.unpaid++;
          }
        } else if (status === "IN_PROGRESS") stats.inProgress++;
        else if (status === "WAITING") stats.waiting++;
        else if (status === "BOOKED") stats.booked++;
        else if (status === "NO_SHOW") stats.noShow++;
        else if (status === "CANCELLED") stats.cancelled++;
      } catch {
        /* slot conflict — advance and skip */
      }
      cursorMin += dur;
    }
  }

  // ── Walk-ins & home visits ──
  // Add ~10 future appointments. Phase 11: cabinet is bound to doctor, so
  // even outreach/telemed bookings land in the doctor's room (the receptionist
  // can move the time later). The slot-overlap check uses the same cabinet.
  const cabinetByDoctor = new Map<string, string>();
  for (const s of schedules) cabinetByDoctor.set(s.doctor.id, s.cabinetId);
  const uniqueDoctors = Array.from(
    new Map(schedules.map((s) => [s.doctor.id, s.doctor])).values(),
  );
  const walkInCount = Math.min(10, uniqueDoctors.length * 2);
  for (let w = 0; w < walkInCount; w++) {
    const m = 10 * 60 + (w * 23) % (8 * 60); // spread across the day
    const startAt = new Date(dayStart);
    startAt.setMinutes(m);
    if (startAt < now) continue; // only future
    const doctor = uniqueDoctors[w % uniqueDoctors.length]!;
    const allowed = allowedByDoctor.get(doctor.id);
    if (!allowed || allowed.size === 0) continue;
    const doctorServices = services.filter((s) => allowed.has(s.id));
    if (doctorServices.length === 0) continue;
    const dur = pickDuration(w * 31);
    const svc = pickServiceByDuration(doctorServices, dur, w);
    const endAt = new Date(startAt.getTime() + svc.durationMin * 60_000);
    const priceBase =
      overrideByPair.get(`${doctor.id}|${svc.id}`) ?? svc.priceBase;
    const patient = patients[(patientCursor + w) % patients.length]!;
    // Walk-ins/telemed share the doctor with the storyline schedule, so we
    // *must* check overlap or two appointments stack on the same slot
    // (visible as a double booking in the calendar).
    const docCabinetId = cabinetByDoctor.get(doctor.id) ?? null;
    if (
      await slotIsTaken({
        doctorId: doctor.id,
        cabinetId: docCabinetId,
        startAt,
        endAt,
      })
    ) {
      continue;
    }
    await prisma.appointment.create({
      data: {
        clinicId,
        patientId: patient.id,
        doctorId: doctor.id,
        cabinetId: docCabinetId,
        serviceId: svc.id,
        date: startAt,
        time: `${pad(startAt.getHours())}:${pad(startAt.getMinutes())}`,
        durationMin: svc.durationMin,
        endDate: endAt,
        status: "BOOKED",
        queueStatus: "BOOKED",
        channel: w % 2 === 0 ? "TELEGRAM" : "PHONE",
        priceService: priceBase,
        priceBase,
        priceFinal: priceBase,
        createdById: receptId,
        notes: w % 3 === 0 ? "Выезд на дом" : "Телемедицина",
      } as never,
    });
    stats.created++;
    stats.booked++;
  }

  return stats;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
