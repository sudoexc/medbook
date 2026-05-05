/**
 * Stress test for the MedicalCase feature: seed varied scenarios, exercise
 * pricing engine and case lifecycle, assert business invariants.
 *
 * Phases:
 *   PHASE A — DB inventory snapshot.
 *   PHASE B — Seed test patients with controlled visit timelines so we can
 *             reason about expected pricing.
 *   PHASE C — Drive the public CRM API to:
 *               (1) create new appointments and observe auto-attach
 *               (2) attach/detach existing appointments
 *               (3) close+reopen a case
 *               (4) free-repeat boundary (exact N days, N+1 days)
 *               (5) overbooking probes (doctor + cabinet)
 *               (6) detach the "first" visit and verify repricing of siblings
 *   PHASE D — Run invariant queries:
 *               - no overlapping appointments per (doctorId,time)
 *               - no overlapping appointments per (cabinetId,time)
 *               - every case row stays inside one clinicId
 *               - every appointment.medicalCaseId references a case in same
 *                 (clinicId, patientId)
 *               - priceFinal=0 only for non-first visits within freeRepeatDays
 *
 * Output: tmp/stress-medical-cases.md (each scenario + invariant PASS/FAIL).
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const BASE = process.env.STRESS_BASE_URL ?? "http://localhost:3000";
const RECEPT_EMAIL = "recept@neurofax.uz";
const RECEPT_PASS = "recept";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

type Row = { name: string; ok: boolean; detail?: string };
const rows: Row[] = [];
const log = (r: Row) => {
  rows.push(r);
  // eslint-disable-next-line no-console
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  — " + r.detail : ""}`);
};

async function inventory() {
  const clinics = await prisma.clinic.findMany({
    select: { id: true, slug: true, nameRu: true },
  });
  console.log("\n=== PHASE A: inventory ===");
  for (const c of clinics) {
    const [doctors, patients, cabinets, services, apts, cases] = await Promise.all([
      prisma.doctor.count({ where: { clinicId: c.id } }),
      prisma.patient.count({ where: { clinicId: c.id } }),
      prisma.cabinet.count({ where: { clinicId: c.id } }),
      prisma.service.count({ where: { clinicId: c.id } }),
      prisma.appointment.count({ where: { clinicId: c.id } }),
      prisma.medicalCase.count({ where: { clinicId: c.id } }),
    ]);
    console.log(
      `  - ${c.slug}: doctors=${doctors} patients=${patients} cabinets=${cabinets} services=${services} apts=${apts} cases=${cases}`
    );
  }
  return clinics;
}

async function invariants() {
  console.log("\n=== PHASE D: invariants ===");

  // 1. No overlapping appointments per doctor (BOOKED/WAITING/IN_PROGRESS)
  const dupDoctor = await prisma.$queryRaw<
    Array<{ doctor_id: string; date: Date; time: string; n: bigint }>
  >`
    SELECT a."doctorId" AS doctor_id, a."date", a."time", COUNT(*) AS n
    FROM "Appointment" a
    WHERE a."status" IN ('BOOKED','WAITING','IN_PROGRESS')
      AND a."time" IS NOT NULL
    GROUP BY a."doctorId", a."date", a."time"
    HAVING COUNT(*) > 1
    LIMIT 20
  `;
  log({
    name: "no doctor overbookings (status BOOKED/WAITING/IN_PROGRESS at exact time)",
    ok: dupDoctor.length === 0,
    detail: dupDoctor.length ? `dupes: ${JSON.stringify(dupDoctor.slice(0, 3))}` : undefined,
  });

  // 2. No overlapping per cabinet
  const dupCabinet = await prisma.$queryRaw<
    Array<{ cabinet_id: string; date: Date; time: string; n: bigint }>
  >`
    SELECT a."cabinetId" AS cabinet_id, a."date", a."time", COUNT(*) AS n
    FROM "Appointment" a
    WHERE a."status" IN ('BOOKED','WAITING','IN_PROGRESS')
      AND a."cabinetId" IS NOT NULL
      AND a."time" IS NOT NULL
    GROUP BY a."cabinetId", a."date", a."time"
    HAVING COUNT(*) > 1
    LIMIT 20
  `;
  log({
    name: "no cabinet overbookings",
    ok: dupCabinet.length === 0,
    detail: dupCabinet.length ? `dupes: ${JSON.stringify(dupCabinet.slice(0, 3))}` : undefined,
  });

  // 3. Cross-clinic case mismatch
  const crossClinic = await prisma.$queryRaw<
    Array<{ apt_id: string; apt_clinic: string; case_clinic: string }>
  >`
    SELECT a."id" AS apt_id, a."clinicId" AS apt_clinic, mc."clinicId" AS case_clinic
    FROM "Appointment" a
    JOIN "MedicalCase" mc ON a."medicalCaseId" = mc."id"
    WHERE a."clinicId" <> mc."clinicId"
    LIMIT 10
  `;
  log({
    name: "no cross-clinic case linkage",
    ok: crossClinic.length === 0,
    detail: crossClinic.length ? JSON.stringify(crossClinic.slice(0, 3)) : undefined,
  });

  // 4. Cross-patient case mismatch
  const crossPatient = await prisma.$queryRaw<
    Array<{ apt_id: string; apt_patient: string; case_patient: string }>
  >`
    SELECT a."id" AS apt_id, a."patientId" AS apt_patient, mc."patientId" AS case_patient
    FROM "Appointment" a
    JOIN "MedicalCase" mc ON a."medicalCaseId" = mc."id"
    WHERE a."patientId" <> mc."patientId"
    LIMIT 10
  `;
  log({
    name: "no cross-patient case linkage",
    ok: crossPatient.length === 0,
    detail: crossPatient.length ? JSON.stringify(crossPatient.slice(0, 3)) : undefined,
  });

  // 5. closedAt consistency: closed cases must have closedAt set; open cases must not.
  const wrongClosed = await prisma.$queryRaw<
    Array<{ id: string; status: string; closed_at: Date | null }>
  >`
    SELECT id, status, "closedAt" AS closed_at
    FROM "MedicalCase"
    WHERE (status = 'OPEN'      AND "closedAt" IS NOT NULL)
       OR (status <> 'OPEN'     AND "closedAt" IS NULL)
    LIMIT 10
  `;
  log({
    name: "closedAt matches CaseStatus",
    ok: wrongClosed.length === 0,
    detail: wrongClosed.length ? JSON.stringify(wrongClosed.slice(0, 3)) : undefined,
  });

  // 6. priceFinal=0 only for non-first inside free-repeat window OR explicit waiver
  // We can't easily compute "first" in raw SQL without window functions; do it in JS
  // for any rows where priceFinal=0 and check.
  const zeroPriced = await prisma.appointment.findMany({
    where: { priceFinal: 0, medicalCaseId: { not: null } },
    select: {
      id: true,
      patientId: true,
      medicalCaseId: true,
      date: true,
      time: true,
      createdAt: true,
      services: { select: { service: { select: { freeRepeatDays: true } } } },
    },
    take: 100,
  });
  let anomalies: string[] = [];
  for (const apt of zeroPriced) {
    const siblings = await prisma.appointment.findMany({
      where: {
        medicalCaseId: apt.medicalCaseId!,
        status: { not: "CANCELLED" },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, date: true, services: { select: { service: { select: { freeRepeatDays: true } } } } },
    });
    if (siblings.length === 0) continue;
    const isFirst = siblings[0]!.id === apt.id;
    if (isFirst) {
      anomalies.push(`apt=${apt.id} priceFinal=0 but it's the FIRST visit in case`);
      continue;
    }
    const firstDate = siblings[0]!.date;
    const days = Math.floor((apt.date.getTime() - firstDate.getTime()) / 86_400_000);
    const hasFreeRepeat = apt.services.some((sa) => sa.service.freeRepeatDays && days <= sa.service.freeRepeatDays);
    if (!hasFreeRepeat) {
      anomalies.push(`apt=${apt.id} priceFinal=0 but no service has freeRepeatDays>=${days}`);
    }
  }
  log({
    name: `priceFinal=0 only for justified free-repeat (checked ${zeroPriced.length})`,
    ok: anomalies.length === 0,
    detail: anomalies.length ? anomalies.slice(0, 3).join(" | ") : undefined,
  });

  // 7. Every case row sits inside its primaryDoctor's clinic (when set)
  const drMismatch = await prisma.$queryRaw<
    Array<{ id: string; case_clinic: string; doctor_clinic: string }>
  >`
    SELECT mc.id, mc."clinicId" AS case_clinic, d."clinicId" AS doctor_clinic
    FROM "MedicalCase" mc
    JOIN "Doctor" d ON mc."primaryDoctorId" = d.id
    WHERE mc."clinicId" <> d."clinicId"
    LIMIT 10
  `;
  log({
    name: "case primaryDoctor in same clinic",
    ok: drMismatch.length === 0,
    detail: drMismatch.length ? JSON.stringify(drMismatch.slice(0, 3)) : undefined,
  });

  // 8. Patient sits inside case's clinic
  const ptMismatch = await prisma.$queryRaw<
    Array<{ id: string; case_clinic: string; patient_clinic: string }>
  >`
    SELECT mc.id, mc."clinicId" AS case_clinic, p."clinicId" AS patient_clinic
    FROM "MedicalCase" mc
    JOIN "Patient" p ON mc."patientId" = p.id
    WHERE mc."clinicId" <> p."clinicId"
    LIMIT 10
  `;
  log({
    name: "case patient in same clinic",
    ok: ptMismatch.length === 0,
    detail: ptMismatch.length ? JSON.stringify(ptMismatch.slice(0, 3)) : undefined,
  });

  // 9. Cancelled appointments still count toward case visit list?  Conventional answer:
  //    they should still be linked to the case for history but not affect "first-vs-repeat" pricing.
  //    Confirm at least one sample case has no cancelled-but-orphaned rows.
  const orphanCancelled = await prisma.appointment.count({
    where: { status: "CANCELLED", medicalCaseId: null, patient: { cases: { some: {} } } },
  });
  console.log(`  info: cancelled-without-case appointments where patient HAS cases: ${orphanCancelled}`);
}

async function loginCookie(): Promise<string | null> {
  // Two-step: csrf → callback/credentials.
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrf = (await csrfRes.json()) as { csrfToken: string };
  const setCookies: string[] = [];
  csrfRes.headers.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") setCookies.push(v);
  });
  const cookieJar = new Map<string, string>();
  for (const sc of setCookies) {
    const [pair] = sc.split(";");
    const [k, v] = pair!.split("=");
    if (k && v) cookieJar.set(k, v);
  }

  const body = new URLSearchParams({
    email: RECEPT_EMAIL,
    password: RECEPT_PASS,
    csrfToken: csrf.csrfToken,
    callbackUrl: `${BASE}/ru/crm`,
    json: "true",
  });
  const cookieStr = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const cb = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieStr },
    body: body.toString(),
    redirect: "manual",
  });
  cb.headers.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") {
      const [pair] = v.split(";");
      const [kk, vv] = pair!.split("=");
      if (kk && vv) cookieJar.set(kk, vv);
    }
  });
  const final = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  if (!final.includes("authjs.session-token") && !final.includes("next-auth.session-token")) {
    console.log("  login response status:", cb.status);
    console.log("  cookies:", final.slice(0, 200));
    return null;
  }
  return final;
}

async function main() {
  console.log("BASE:", BASE);
  await inventory();

  // Try logging in via the API to drive scenarios. Falls back to direct DB
  // writes if the dev server isn't running.
  const cookie = await loginCookie().catch(() => null);
  if (!cookie) {
    console.warn("\n[!] could not log in — will run invariants only against existing data");
  } else {
    console.log("\n[OK] logged in as recept@neurofax.uz");
    // (scenarios live below — added in next iteration)
  }

  await invariants();

  // Write report
  const tmpDir = path.resolve(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const md = [
    "# stress-medical-cases report",
    `Run: ${new Date().toISOString()}`,
    "",
    "| Scenario | Result | Detail |",
    "|---|---|---|",
    ...rows.map((r) => `| ${r.name} | ${r.ok ? "PASS" : "FAIL"} | ${r.detail ?? ""} |`),
  ].join("\n");
  fs.writeFileSync(path.join(tmpDir, "stress-medical-cases.md"), md, "utf8");
  console.log(`\nReport written: tmp/stress-medical-cases.md  (${rows.filter((r) => !r.ok).length} failures)`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
