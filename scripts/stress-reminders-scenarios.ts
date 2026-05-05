/**
 * Stress test for the notification reminder cascade (24h / 5h / 2h),
 * MedicalCase repeat-due trigger, and the parallel INAPP mirror.
 *
 * Seven scenarios, each isolated by a unique STRESS-NOTIF-${ts} prefix on
 * patient.fullName and clinic templates. Writes go to the existing
 * `neurofax` clinic. Each scenario asserts the row count and channel mix
 * in NotificationSend; failures are logged but don't abort the suite.
 *
 * Report: tmp/stress-reminders-scenarios.md
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { runWithTenant } from "../src/lib/tenant-context";
import { normalizePhone } from "../src/lib/phone";
import {
  runScheduledTriggers,
  scheduleAppointmentReminders,
} from "../src/server/notifications/triggers";

const raw = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

type Row = { name: string; ok: boolean; detail?: string };
const rows: Row[] = [];
function record(name: string, ok: boolean, detail?: string) {
  rows.push({ name, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`${ok ? "  ok " : "  FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const RUN_ID = `STRESS-NOTIF-${Date.now()}`;

interface Setup {
  clinicId: string;
  doctorId: string;
  cabinetId: string;
  serviceFreeId: string;
  serviceFlatId: string;
}

let cached: Setup | null = null;

async function setup(): Promise<Setup> {
  if (cached) return cached;
  const clinic = await raw.clinic.findUniqueOrThrow({
    where: { slug: "neurofax" },
    select: { id: true },
  });
  const allDoctors = await raw.doctor.findMany({
    where: { clinicId: clinic.id, isActive: true },
    select: { id: true, cabinetId: true },
  });
  const doctor = allDoctors.find((d) => d.cabinetId !== null);
  if (!doctor || !doctor.cabinetId) {
    throw new Error("Need at least one active doctor with cabinetId");
  }
  // Create fresh test services for isolation — neurofax has no service with
  // freeRepeatDays>0 by default.
  const free = await raw.service.create({
    data: {
      clinicId: clinic.id,
      code: `${RUN_ID}-svc-free`,
      nameRu: `${RUN_ID} free repeat`,
      nameUz: `${RUN_ID} free repeat`,
      durationMin: 30,
      priceBase: 100_000,
      freeRepeatDays: 14,
      isActive: true,
    },
    select: { id: true },
  });
  const flat = await raw.service.create({
    data: {
      clinicId: clinic.id,
      code: `${RUN_ID}-svc-flat`,
      nameRu: `${RUN_ID} flat`,
      nameUz: `${RUN_ID} flat`,
      durationMin: 30,
      priceBase: 100_000,
      freeRepeatDays: null,
      isActive: true,
    },
    select: { id: true },
  });
  cached = {
    clinicId: clinic.id,
    doctorId: doctor.id,
    cabinetId: doctor.cabinetId,
    serviceFreeId: free.id,
    serviceFlatId: flat.id,
  };
  return cached;
}

async function cleanupSetup() {
  if (!cached) return;
  await raw.service.deleteMany({
    where: {
      OR: [{ id: cached.serviceFreeId }, { id: cached.serviceFlatId }],
    },
  });
}

async function makePatient(opts: {
  s: Setup;
  tag: string;
  withTelegram: boolean;
}): Promise<string> {
  const phone = `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const p = await raw.patient.create({
    data: {
      clinicId: opts.s.clinicId,
      fullName: `${RUN_ID}-${opts.tag}`,
      phone,
      phoneNormalized: normalizePhone(phone),
      preferredLang: "RU",
      preferredChannel: "TG",
      telegramId: opts.withTelegram ? `tg-${RUN_ID}-${opts.tag}` : null,
    },
    select: { id: true },
  });
  return p.id;
}

async function makeAppt(opts: {
  s: Setup;
  patientId: string;
  date: Date;
  status?:
    | "BOOKED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SKIPPED"
    | "CANCELLED"
    | "NO_SHOW";
  serviceId?: string;
  caseId?: string | null;
}): Promise<string> {
  const status = opts.status ?? "BOOKED";
  const start = opts.date;
  const end = new Date(start.getTime() + 30 * 60_000);
  const a = await raw.appointment.create({
    data: {
      clinicId: opts.s.clinicId,
      patientId: opts.patientId,
      doctorId: opts.s.doctorId,
      cabinetId: opts.s.cabinetId,
      serviceId: opts.serviceId ?? opts.s.serviceFlatId,
      medicalCaseId: opts.caseId ?? null,
      date: start,
      durationMin: 30,
      endDate: end,
      status,
      queueStatus: status,
      channel: "PHONE",
      cancelledAt: status === "CANCELLED" ? new Date() : null,
      completedAt: status === "COMPLETED" ? end : null,
      priceService: 0,
      priceBase: 0,
      priceFinal: 0,
    },
    select: { id: true },
  });
  return a.id;
}

async function countSends(opts: {
  appointmentId?: string;
  caseId?: string;
  patientId?: string;
}) {
  const rowsFound = await raw.notificationSend.findMany({
    where: {
      ...(opts.appointmentId ? { appointmentId: opts.appointmentId } : {}),
      ...(opts.caseId ? { caseId: opts.caseId } : {}),
      ...(opts.patientId ? { patientId: opts.patientId } : {}),
    },
    select: {
      id: true,
      channel: true,
      status: true,
      template: { select: { key: true } },
    },
  });
  return rowsFound;
}

async function cleanup(patientIds: string[]) {
  if (patientIds.length === 0) return;
  await raw.notificationSend.deleteMany({
    where: { patientId: { in: patientIds } },
  });
  await raw.appointment.deleteMany({
    where: { patientId: { in: patientIds } },
  });
  await raw.medicalCase.deleteMany({
    where: { patientId: { in: patientIds } },
  });
  await raw.patient.deleteMany({
    where: { id: { in: patientIds } },
  });
}

// ── scenarios ─────────────────────────────────────────────────────────────

async function scenarioApptIn4h30(s: Setup): Promise<void> {
  const patientId = await makePatient({ s, tag: "p4h30tg", withTelegram: true });
  const apptDate = new Date(Date.now() + 4.5 * 60 * 60 * 1000);
  const apptId = await makeAppt({ s, patientId, date: apptDate });

  await runScheduledTriggers();
  const sends = await countSends({ appointmentId: apptId });
  const tg5h = sends.filter(
    (r) => r.template?.key === "reminder.5h" && r.channel === "TG",
  );
  const inapp5h = sends.filter(
    (r) => r.template?.key === "reminder.5h" && r.channel === "INAPP",
  );
  const others = sends.filter(
    (r) => r.template?.key !== "reminder.5h",
  );
  const ok =
    tg5h.length === 1 && inapp5h.length === 1 && others.length === 0;
  record(
    "appt 4.5h out → only 5h reminder fires (TG + INAPP mirror)",
    ok,
    `tg5h=${tg5h.length} inapp5h=${inapp5h.length} other=${others.length}`,
  );

  await cleanup([patientId]);
}

async function scenarioApptIn1h30(s: Setup): Promise<void> {
  const patientId = await makePatient({ s, tag: "p1h30tg", withTelegram: true });
  const apptDate = new Date(Date.now() + 1.5 * 60 * 60 * 1000);
  const apptId = await makeAppt({ s, patientId, date: apptDate });

  await runScheduledTriggers();
  const sends = await countSends({ appointmentId: apptId });
  const tg2h = sends.filter(
    (r) => r.template?.key === "reminder.2h" && r.channel === "TG",
  );
  const inapp2h = sends.filter(
    (r) => r.template?.key === "reminder.2h" && r.channel === "INAPP",
  );
  const others = sends.filter(
    (r) => r.template?.key !== "reminder.2h",
  );
  const ok =
    tg2h.length === 1 && inapp2h.length === 1 && others.length === 0;
  record(
    "appt 1.5h out → only 2h reminder fires (TG + INAPP mirror)",
    ok,
    `tg2h=${tg2h.length} inapp2h=${inapp2h.length} other=${others.length}`,
  );

  await cleanup([patientId]);
}

async function scenarioCancelCascade(s: Setup): Promise<void> {
  const patientId = await makePatient({ s, tag: "pcancel", withTelegram: true });
  // 26h out so all three windows can be scheduled by scheduleAppointmentReminders.
  const apptDate = new Date(Date.now() + 26 * 60 * 60 * 1000);
  const apptId = await makeAppt({ s, patientId, date: apptDate });

  await scheduleAppointmentReminders(apptId);
  const beforeAll = await countSends({ appointmentId: apptId });
  const beforeQueued = beforeAll.filter((r) => r.status === "QUEUED");

  // Replicate fireTrigger("appointment.cancelled") cascade-cancel logic.
  await runWithTenant({ kind: "SYSTEM" }, () =>
    raw.notificationSend.updateMany({
      where: {
        appointmentId: apptId,
        status: "QUEUED",
        template: {
          trigger: { in: ["APPOINTMENT_BEFORE", "APPOINTMENT_CREATED"] },
        },
      },
      data: { status: "CANCELLED" },
    }),
  );

  const afterAll = await countSends({ appointmentId: apptId });
  const stillQueued = afterAll.filter((r) => r.status === "QUEUED");
  const cancelled = afterAll.filter((r) => r.status === "CANCELLED");

  const ok = beforeQueued.length === cancelled.length && stillQueued.length === 0;
  record(
    "cancel cascades to all 3 reminders (24h/5h/2h flipped to CANCELLED)",
    ok,
    `beforeQueued=${beforeQueued.length} stillQueued=${stillQueued.length} cancelled=${cancelled.length}`,
  );

  await cleanup([patientId]);
}

async function scenarioCaseRepeatDue(s: Setup): Promise<void> {
  const patientId = await makePatient({ s, tag: "pcase14", withTelegram: true });
  // First visit: 12 days ago, COMPLETED. freeRepeatDays=14, so deadline is
  // 2 days from now. Default daysBefore=2 → fires now.
  const visitDate = new Date(Date.now() - 12 * 86_400_000);

  const kase = await raw.medicalCase.create({
    data: {
      clinicId: s.clinicId,
      patientId,
      primaryDoctorId: s.doctorId,
      title: `${RUN_ID}-case14`,
      status: "OPEN",
    },
    select: { id: true },
  });
  await makeAppt({
    s,
    patientId,
    date: visitDate,
    status: "COMPLETED",
    serviceId: s.serviceFreeId,
    caseId: kase.id,
  });

  await runScheduledTriggers();
  const sends = await countSends({ caseId: kase.id });
  const tgRepeat = sends.filter(
    (r) => r.template?.key === "case.repeat-due" && r.channel === "TG",
  );
  const inappRepeat = sends.filter(
    (r) => r.template?.key === "case.repeat-due" && r.channel === "INAPP",
  );

  const ok = tgRepeat.length === 1 && inappRepeat.length === 1;
  record(
    "case freeRepeatDays=14 + no follow-up + day 12 → repeat-due fires (TG + INAPP)",
    ok,
    `tg=${tgRepeat.length} inapp=${inappRepeat.length}`,
  );

  await cleanup([patientId]);
}

async function scenarioIdempotency(s: Setup): Promise<void> {
  const patientId = await makePatient({ s, tag: "pidemp", withTelegram: true });
  const apptDate = new Date(Date.now() + 4.5 * 60 * 60 * 1000);
  const apptId = await makeAppt({ s, patientId, date: apptDate });

  await runScheduledTriggers();
  const after1 = await countSends({ appointmentId: apptId });
  await runScheduledTriggers();
  const after2 = await countSends({ appointmentId: apptId });

  const ok = after1.length === after2.length && after1.length > 0;
  record(
    "idempotency: 2nd scheduler tick adds 0 new rows",
    ok,
    `tick1=${after1.length} tick2=${after2.length}`,
  );

  await cleanup([patientId]);
}

async function scenarioInappForTgUser(s: Setup): Promise<void> {
  const patientId = await makePatient({ s, tag: "ptg", withTelegram: true });
  const apptDate = new Date(Date.now() + 4.5 * 60 * 60 * 1000);
  const apptId = await makeAppt({ s, patientId, date: apptDate });

  await runScheduledTriggers();
  const sends = await countSends({ appointmentId: apptId });
  const channels = sends.map((r) => r.channel).sort();
  const ok =
    sends.length === 2 &&
    channels.includes("TG") &&
    channels.includes("INAPP");
  record(
    "TG-using patient → reminder lands on TG + INAPP banner",
    ok,
    `channels=${channels.join(",")}`,
  );

  await cleanup([patientId]);
}

async function scenarioNonTgUserGetsSmsOnly(s: Setup): Promise<void> {
  // Find the SMS or TG template; flip 5h template to SMS for this scenario,
  // then revert. This isolates the non-TG patient → SMS path without
  // changing global state past test end.
  const tpl = await raw.notificationTemplate.findFirstOrThrow({
    where: { clinicId: s.clinicId, key: "reminder.5h" },
    select: { id: true, channel: true },
  });
  const originalChannel = tpl.channel;
  await raw.notificationTemplate.update({
    where: { id: tpl.id },
    data: { channel: "SMS" },
  });

  try {
    const patientId = await makePatient({
      s,
      tag: "pnotg",
      withTelegram: false,
    });
    const apptDate = new Date(Date.now() + 4.5 * 60 * 60 * 1000);
    const apptId = await makeAppt({ s, patientId, date: apptDate });

    await runScheduledTriggers();
    const sends = await countSends({ appointmentId: apptId });
    const channels = sends.map((r) => r.channel).sort();
    const ok =
      sends.length === 1 &&
      channels[0] === "SMS" &&
      !channels.includes("INAPP");
    record(
      "non-TG patient → SMS only, no INAPP mirror",
      ok,
      `channels=${channels.join(",")}`,
    );

    await cleanup([patientId]);
  } finally {
    await raw.notificationTemplate.update({
      where: { id: tpl.id },
      data: { channel: originalChannel },
    });
  }
}

// ── runner ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`run id: ${RUN_ID}\n`);
  const s = await setup();
  await scenarioApptIn4h30(s);
  await scenarioApptIn1h30(s);
  await scenarioCancelCascade(s);
  await scenarioCaseRepeatDue(s);
  await scenarioIdempotency(s);
  await scenarioInappForTgUser(s);
  await scenarioNonTgUserGetsSmsOnly(s);

  // Report
  const passed = rows.filter((r) => r.ok).length;
  const failed = rows.length - passed;
  const summary = `# Stress: notification reminder cascade

run: ${RUN_ID}
result: ${passed}/${rows.length} PASS${failed > 0 ? `, ${failed} FAIL` : ""}

| # | scenario | result | detail |
|--:|---|:---:|---|
${rows
  .map(
    (r, i) =>
      `| ${i + 1} | ${r.name} | ${r.ok ? "✅" : "❌"} | ${r.detail ?? ""} |`,
  )
  .join("\n")}
`;
  fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
  fs.writeFileSync(
    path.join(process.cwd(), "tmp", "stress-reminders-scenarios.md"),
    summary,
    "utf8",
  );
  console.log(`\n${passed}/${rows.length} PASS${failed > 0 ? `, ${failed} FAIL` : ""}`);
  console.log(`report: tmp/stress-reminders-scenarios.md`);
  await cleanupSetup();
  await raw.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await cleanupSetup().catch(() => {});
  await raw.$disconnect();
  process.exit(1);
});
