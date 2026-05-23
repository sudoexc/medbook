/**
 * Drives MedicalCase scenarios end-to-end against the LOCAL database +
 * pricing engine. We bypass the HTTP layer for speed and full control over
 * dates / createdAt / status; the pricing engine is invoked directly so any
 * skew between DB state and engine output is the engine's fault — not the
 * route's mass of side-effects (audit, notifications, SSE).
 *
 * Each SCENARIO writes a header, exercises the case, then asserts the
 * post-state. PASS/FAIL recorded into `rows`, written to
 * tmp/stress-cases-scenarios.md at the end. Any assertion failure is a
 * business-logic bug, not a transient flake.
 *
 * ALL writes go inside `clinicId='neurofax'` so we never touch demo data.
 * Test entities prefixed `STRESS::` so they're easy to grep + delete.
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { runWithTenant } from "../src/lib/tenant-context";
import {
  recomputeAppointmentPrice,
  recomputeCaseAppointments,
} from "../src/server/pricing/recompute-appointment-price";
import { prisma as scopedPrisma } from "../src/lib/prisma";

// Raw client: no tenant scoping. We control clinicId on every write.
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

// Day reference: pick a date 60d in the past so we can place visits relative
// to it without bumping into "in_past" guards (those only fire on HTTP).
const now = new Date();
const baseDay = new Date(now.getTime() - 60 * 86_400_000);
function dayOffset(n: number, hour = 10, minute = 0): Date {
  const d = new Date(baseDay);
  d.setDate(d.getDate() + n);
  d.setHours(hour, minute, 0, 0);
  return d;
}

interface Setup {
  clinicId: string;
  doctorId: string;
  cabinetId: string;
  patientId: string;
  serviceFreeId: string; // freeRepeatDays=14
  serviceFlatId: string; // freeRepeatDays=null (paid every visit)
}

let doctorPool: Array<{ id: string; cabinetId: string | null }> = [];
let doctorIdx = 0;

async function setupFixture(label: string): Promise<Setup> {
  const clinic = await raw.clinic.findUniqueOrThrow({
    where: { slug: "neurofax" },
    select: { id: true },
  });
  if (doctorPool.length === 0) {
    const all = await raw.doctor.findMany({
      where: { clinicId: clinic.id, isActive: true },
      select: { id: true, cabinetId: true },
      orderBy: { id: "asc" },
    });
    doctorPool = all.filter((d): d is { id: string; cabinetId: string } => d.cabinetId !== null);
  }
  // Round-robin: each scenario gets its own doctor → no exclusion constraint
  // collisions between scenarios.
  const doctor = doctorPool[doctorIdx++ % doctorPool.length]!;
  if (!doctor.cabinetId) {
    throw new Error("setupFixture: doctor without cabinet");
  }

  const phone = `+9989000${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
  const patient = await raw.$transaction(async (tx) => {
    const c = await tx.clinic.update({
      where: { id: clinic.id },
      data: { patientCounter: { increment: 1 } },
      select: { patientCounter: true },
    });
    return tx.patient.create({
      data: {
        clinicId: clinic.id,
        patientNumber: c.patientCounter,
        fullName: `STRESS::${label}::${Date.now().toString(36)}`,
        phone,
        phoneNormalized: phone.replace(/\D/g, ""),
      },
      select: { id: true },
    });
  });

  // Fresh services so no other test mutates them.
  const codeFree = `STRESS_FREE_${Math.random().toString(36).slice(2, 8)}`;
  const codeFlat = `STRESS_FLAT_${Math.random().toString(36).slice(2, 8)}`;
  const sFree = await raw.service.create({
    data: {
      clinicId: clinic.id,
      code: codeFree,
      nameRu: `Stress free repeat ${label}`,
      nameUz: `Stress free repeat ${label}`,
      durationMin: 30,
      priceBase: 200_000,
      freeRepeatDays: 14,
      isActive: true,
    },
    select: { id: true },
  });
  const sFlat = await raw.service.create({
    data: {
      clinicId: clinic.id,
      code: codeFlat,
      nameRu: `Stress flat ${label}`,
      nameUz: `Stress flat ${label}`,
      durationMin: 30,
      priceBase: 150_000,
      freeRepeatDays: null,
      isActive: true,
    },
    select: { id: true },
  });

  return {
    clinicId: clinic.id,
    doctorId: doctor.id,
    cabinetId: doctor.cabinetId,
    patientId: patient.id,
    serviceFreeId: sFree.id,
    serviceFlatId: sFlat.id,
  };
}

async function makeCase(
  setup: Setup,
  title: string,
  status: "OPEN" | "RESOLVED" = "OPEN",
): Promise<string> {
  const c = await raw.medicalCase.create({
    data: {
      clinicId: setup.clinicId,
      patientId: setup.patientId,
      primaryDoctorId: setup.doctorId,
      title: `STRESS::${title}`,
      status,
      openedAt: dayOffset(0),
      closedAt: status === "OPEN" ? null : dayOffset(60),
    },
    select: { id: true },
  });
  return c.id;
}

async function makeAppt(
  setup: Setup,
  caseId: string | null,
  date: Date,
  serviceId: string,
  priceBase: number,
  status: "BOOKED" | "COMPLETED" | "CANCELLED" = "BOOKED",
  options: { discountPct?: number } = {},
): Promise<string> {
  const start = date;
  const end = new Date(start.getTime() + 30 * 60_000);
  const a = await raw.appointment.create({
    data: {
      clinicId: setup.clinicId,
      patientId: setup.patientId,
      doctorId: setup.doctorId,
      cabinetId: setup.cabinetId,
      serviceId,
      medicalCaseId: caseId,
      date: start,
      time: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
      durationMin: 30,
      endDate: end,
      status,
      queueStatus: status,
      cancelledAt: status === "CANCELLED" ? new Date() : null,
      completedAt: status === "COMPLETED" ? end : null,
      channel: "PHONE",
      priceService: priceBase,
      priceBase,
      priceFinal: priceBase,
      discountPct: options.discountPct ?? 0,
      discountAmount: 0,
    },
    select: { id: true },
  });
  await raw.appointmentService.create({
    data: {
      clinicId: setup.clinicId,
      appointmentId: a.id,
      serviceId,
      priceSnap: priceBase,
      quantity: 1,
    },
  });
  return a.id;
}

async function reprice(id: string) {
  return runWithTenant(
    { kind: "SYSTEM" },
    async () => recomputeAppointmentPrice(scopedPrisma, id),
  );
}

async function repriceCase(caseId: string) {
  return runWithTenant(
    { kind: "SYSTEM" },
    async () => recomputeCaseAppointments(scopedPrisma, caseId),
  );
}

async function getApt(id: string) {
  return raw.appointment.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      status: true,
      date: true,
      priceFinal: true,
      priceBase: true,
      priceService: true,
      medicalCaseId: true,
    },
  });
}

async function cleanup(setup: Setup) {
  // Cascade delete via case + manual bits.
  await raw.appointmentService.deleteMany({
    where: { appointment: { patientId: setup.patientId } },
  });
  await raw.appointment.deleteMany({ where: { patientId: setup.patientId } });
  await raw.medicalCase.deleteMany({ where: { patientId: setup.patientId } });
  await raw.patient.delete({ where: { id: setup.patientId } });
  await raw.service.deleteMany({
    where: { id: { in: [setup.serviceFreeId, setup.serviceFlatId] } },
  });
}

// ---------- SCENARIOS ----------

/**
 * S1: free-repeat boundary.
 *  Day 0  → 200k full
 *  Day 5  → free
 *  Day 14 → free (boundary inclusive)
 *  Day 15 → full
 */
async function s1_freeRepeatBoundary() {
  console.log("\n[S1] free-repeat boundary (14d window)");
  const setup = await setupFixture("S1");
  const caseId = await makeCase(setup, "S1");

  const a0 = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  const a5 = await makeAppt(setup, caseId, dayOffset(5), setup.serviceFreeId, 200_000);
  const a14 = await makeAppt(setup, caseId, dayOffset(14), setup.serviceFreeId, 200_000);
  const a15 = await makeAppt(setup, caseId, dayOffset(15), setup.serviceFreeId, 200_000);

  for (const id of [a0, a5, a14, a15]) await reprice(id);

  const rows0 = await Promise.all([a0, a5, a14, a15].map((id) => getApt(id)));
  record("S1.day0 priceFinal=200k (first)", rows0[0]!.priceFinal === 200_000, `got ${rows0[0]!.priceFinal}`);
  record("S1.day5 priceFinal=0 (free)", rows0[1]!.priceFinal === 0, `got ${rows0[1]!.priceFinal}`);
  record("S1.day14 priceFinal=0 (boundary inclusive)", rows0[2]!.priceFinal === 0, `got ${rows0[2]!.priceFinal}`);
  record("S1.day15 priceFinal=200k (outside window)", rows0[3]!.priceFinal === 200_000, `got ${rows0[3]!.priceFinal}`);

  await cleanup(setup);
}

/**
 * S2: cancelled-first-visit bug.
 *  Day 0 → A (CANCELLED)  — patient cancelled before showing up
 *  Day 5 → B (BOOKED)     — first real visit
 *  Expectation (business): B should be priced as the first visit (200k).
 *  Actual (suspected bug): A still counts as the chronological first → B is "repeat" → 0.
 */
async function s2_cancelledFirst() {
  console.log("\n[S2] cancelled first visit");
  const setup = await setupFixture("S2");
  const caseId = await makeCase(setup, "S2");

  const a0 = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000, "CANCELLED");
  const a5 = await makeAppt(setup, caseId, dayOffset(5), setup.serviceFreeId, 200_000, "BOOKED");
  // Mirror what the routes do post-fix: any change in the case → reprice case.
  await repriceCase(caseId);

  const a5Row = await getApt(a5);
  record(
    "S2 cancelled first should NOT make day5 free",
    a5Row.priceFinal === 200_000,
    `got priceFinal=${a5Row.priceFinal} (expected 200000)`,
  );

  await cleanup(setup);
}

/**
 * S3: cancellation does not propagate to siblings (no recompute trigger).
 *  Day 0 → A (BOOKED, full 200k)
 *  Day 5 → B (BOOKED, 0 free) — case has it as repeat
 *  Now we cancel A via DELETE-equivalent (status=CANCELLED, no reprice).
 *  Expectation: B should be repriced to 200k (it's the only real visit now).
 *  Actual: B stays at 0 because the cancel route doesn't touch siblings.
 */
async function s3_cancelNoPropagate() {
  console.log("\n[S3] cancel doesn't propagate repricing");
  const setup = await setupFixture("S3");
  const caseId = await makeCase(setup, "S3");

  const a0 = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  const a5 = await makeAppt(setup, caseId, dayOffset(5), setup.serviceFreeId, 200_000);
  await reprice(a0);
  await reprice(a5);

  const before = await getApt(a5);
  record("S3.before — day5 priced as free repeat", before.priceFinal === 0, `got ${before.priceFinal}`);

  // Simulate the cancel path on appointment-detail DELETE — post-fix, the
  // route reprices every sibling in the case after cancelling.
  await raw.appointment.update({
    where: { id: a0 },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  await repriceCase(caseId);

  const after = await getApt(a5);
  record(
    "S3.after — day5 should have flipped to 200k after cancelling day0",
    after.priceFinal === 200_000,
    `got priceFinal=${after.priceFinal} (expected 200000)`,
  );

  await cleanup(setup);
}

/**
 * S4: per-service eligibility — flat-rate service ignores free-repeat.
 *  Day 0 → A (FREE service, 200k)        — first
 *  Day 5 → B (FLAT service, 150k)        — repeat but flat: 150k
 *  Day 5 → C (FREE+FLAT, 200k+150k=350k) — free zeros 200k; 150k stays
 */
async function s4_perService() {
  console.log("\n[S4] per-service free-repeat eligibility");
  const setup = await setupFixture("S4");
  const caseId = await makeCase(setup, "S4");

  // A: only free-repeat service.
  const aId = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  // B: flat service — no freeRepeatDays even though it's the second visit.
  const bId = await makeAppt(setup, caseId, dayOffset(5), setup.serviceFlatId, 150_000);
  // C: BOTH free + flat → primaryService=free, additional=flat.
  const cStart = dayOffset(5, 14);
  const cEnd = new Date(cStart.getTime() + 30 * 60_000);
  const c = await raw.appointment.create({
    data: {
      clinicId: setup.clinicId,
      patientId: setup.patientId,
      doctorId: setup.doctorId,
      cabinetId: setup.cabinetId,
      serviceId: setup.serviceFreeId,
      medicalCaseId: caseId,
      date: cStart,
      time: "14:00",
      durationMin: 30,
      endDate: cEnd,
      status: "BOOKED",
      channel: "PHONE",
      priceService: 350_000,
      priceBase: 350_000,
      priceFinal: 350_000,
    },
    select: { id: true },
  });
  await raw.appointmentService.createMany({
    data: [
      { clinicId: setup.clinicId, appointmentId: c.id, serviceId: setup.serviceFreeId, priceSnap: 200_000, quantity: 1 },
      { clinicId: setup.clinicId, appointmentId: c.id, serviceId: setup.serviceFlatId, priceSnap: 150_000, quantity: 1 },
    ],
  });

  for (const id of [aId, bId, c.id]) await reprice(id);
  const aR = await getApt(aId);
  const bR = await getApt(bId);
  const cR = await getApt(c.id);

  record("S4.A first visit 200k", aR.priceFinal === 200_000, `got ${aR.priceFinal}`);
  record("S4.B flat-service repeat charged 150k", bR.priceFinal === 150_000, `got ${bR.priceFinal}`);
  record("S4.C mixed: free zeroes 200k, flat keeps 150k → 150k", cR.priceFinal === 150_000, `got ${cR.priceFinal}`);

  await cleanup(setup);
}

/**
 * S5: detach the chronologically-first visit.
 *  Day 0 → A (full)    case=K
 *  Day 5 → B (free)    case=K
 *  Detach A from K. Then K has only B → B should reprice to FULL (it's now first).
 *  A is case-less → priceFinal= what the row had before (engine returns "normal" + leaves it).
 */
async function s5_detachFirst() {
  console.log("\n[S5] detach chronologically-first visit");
  const setup = await setupFixture("S5");
  const caseId = await makeCase(setup, "S5");

  const a = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  const b = await makeAppt(setup, caseId, dayOffset(5), setup.serviceFreeId, 200_000);
  await reprice(a);
  await reprice(b);

  // Simulate the detach endpoint: clear medicalCaseId on A, then reprice both.
  await raw.appointment.update({ where: { id: a }, data: { medicalCaseId: null } });
  await reprice(a);
  await reprice(b);

  const bAfter = await getApt(b);
  record(
    "S5 after detach — B becomes new first → 200k",
    bAfter.priceFinal === 200_000,
    `got ${bAfter.priceFinal}`,
  );

  await cleanup(setup);
}

/**
 * S6: parallel cases for the same patient (back pain + pregnancy).
 *  Two open cases, each with its own first visit. Repeats on either don't
 *  pollute the other's pricing.
 */
async function s6_parallelCases() {
  console.log("\n[S6] parallel cases on same patient");
  const setup = await setupFixture("S6");
  const caseA = await makeCase(setup, "S6.back");
  const caseB = await makeCase(setup, "S6.pregnancy");

  const a1 = await makeAppt(setup, caseA, dayOffset(0), setup.serviceFreeId, 200_000);
  const a2 = await makeAppt(setup, caseA, dayOffset(7), setup.serviceFreeId, 200_000);
  // Different case — its day 0 is the case-A day 7
  const b1 = await makeAppt(setup, caseB, dayOffset(7, 14), setup.serviceFreeId, 200_000);
  const b2 = await makeAppt(setup, caseB, dayOffset(10, 14), setup.serviceFreeId, 200_000);

  for (const id of [a1, a2, b1, b2]) await reprice(id);

  const r = await Promise.all([a1, a2, b1, b2].map(getApt));
  record("S6.A first 200k", r[0]!.priceFinal === 200_000);
  record("S6.A repeat 0", r[1]!.priceFinal === 0);
  record("S6.B first (independent case) 200k — not contaminated by A", r[2]!.priceFinal === 200_000, `got ${r[2]!.priceFinal}`);
  record("S6.B repeat 0", r[3]!.priceFinal === 0);

  await cleanup(setup);
}

/**
 * S7: idempotency — calling reprice twice on same row yields same result.
 */
async function s7_idempotency() {
  console.log("\n[S7] idempotency");
  const setup = await setupFixture("S7");
  const caseId = await makeCase(setup, "S7");
  const a = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  const b = await makeAppt(setup, caseId, dayOffset(5), setup.serviceFreeId, 200_000);
  await reprice(a);
  await reprice(b);
  const r1 = await getApt(b);
  await reprice(b);
  const r2 = await getApt(b);
  record(
    "S7 idempotent",
    r1.priceFinal === r2.priceFinal && r1.priceBase === r2.priceBase,
    `r1.final=${r1.priceFinal} r2.final=${r2.priceFinal}`,
  );
  await cleanup(setup);
}

/**
 * S8: discountPct stacking on free-repeat. If priceBase=0 (everything free
 * via free-repeat) and patient has a 10% discount, priceFinal must remain 0
 * (no negative magic).
 */
async function s8_discountStack() {
  console.log("\n[S8] discount stacking on free repeat");
  const setup = await setupFixture("S8");
  const caseId = await makeCase(setup, "S8");
  const a = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  const b = await makeAppt(
    setup,
    caseId,
    dayOffset(5),
    setup.serviceFreeId,
    200_000,
    "BOOKED",
    { discountPct: 10 },
  );
  await reprice(a);
  await reprice(b);
  const bRow = await getApt(b);
  record("S8 free-repeat + 10% discount stays 0", bRow.priceFinal === 0, `got ${bRow.priceFinal}`);
  await cleanup(setup);
}

/**
 * S10: late-create that becomes new first.
 *  Day 5 → A first (200k)
 *  Day 0 → B inserted later, backdated to Day 0. B is now chronological first.
 *  Expectation: A flips to "repeat" (free). B is full.
 *  Likely bug: CREATE only reprices the new row (B). A stays at full price.
 */
async function s10_backdatedCreate() {
  console.log("\n[S10] backdated CREATE inserts new first");
  const setup = await setupFixture("S10");
  const caseId = await makeCase(setup, "S10");
  const a = await makeAppt(setup, caseId, dayOffset(5), setup.serviceFreeId, 200_000);
  await reprice(a);
  const aFirst = await getApt(a);
  record("S10.before A is first 200k", aFirst.priceFinal === 200_000, `got ${aFirst.priceFinal}`);

  const b = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  // CREATE route post-fix reprices the case (so a backdated insert flips
  // the previous first to a free repeat).
  await reprice(b);
  await repriceCase(caseId);

  const aAfter = await getApt(a);
  record(
    "S10.after A should flip to free (B is new first)",
    aAfter.priceFinal === 0,
    `got ${aAfter.priceFinal}`,
  );
  const bAfter = await getApt(b);
  record(
    "S10.after B is new first → 200k",
    bAfter.priceFinal === 200_000,
    `got ${bAfter.priceFinal}`,
  );
  await cleanup(setup);
}

/**
 * S9: reschedule the first visit so it becomes second-by-date. The pricing
 * engine should:
 *  - reprice the rescheduled appointment based on NEW order
 *  - reprice siblings whose ordinal flipped
 * BUT: PATCH's recompute is currently called on the moved row only — siblings
 * are not repriced. Demonstrate.
 */
async function s9_rescheduleFirstLater() {
  console.log("\n[S9] reschedule first visit to later than sibling");
  const setup = await setupFixture("S9");
  const caseId = await makeCase(setup, "S9");
  const a = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  const b = await makeAppt(setup, caseId, dayOffset(5), setup.serviceFreeId, 200_000);
  await reprice(a);
  await reprice(b);
  // Move A to day 30 (after B and outside window — A becomes a real follow-up,
  // B becomes the new first).
  await raw.appointment.update({
    where: { id: a },
    data: {
      date: dayOffset(30),
      endDate: new Date(dayOffset(30).getTime() + 30 * 60_000),
    },
  });
  // Mirror PATCH post-fix: reprice the moved row + the whole case.
  await reprice(a);
  await repriceCase(caseId);

  const bAfter = await getApt(b);
  record(
    "S9 sibling B becomes new first → 200k after reschedule of A",
    bAfter.priceFinal === 200_000,
    `got ${bAfter.priceFinal}`,
  );
  // A moved to day 30 — outside the 14-day window from B (the new first).
  // It should now be priced as a regular full-cost follow-up.
  const aAfter = await getApt(a);
  record(
    "S9 A repriced as outside-window follow-up → 200k",
    aAfter.priceFinal === 200_000,
    `got ${aAfter.priceFinal}`,
  );
  await cleanup(setup);
}

/**
 * S11: NO_SHOW first visit. Same as S2 but with NO_SHOW status — patient
 * never came, the "first visit" anchor must NOT live in this row.
 */
async function s11_noShowFirst() {
  console.log("\n[S11] no-show first visit");
  const setup = await setupFixture("S11");
  const caseId = await makeCase(setup, "S11");
  // NO_SHOW is only legal once the appointment date is in the past — but the
  // engine doesn't care about that, only status. We set the row up directly.
  const a0 = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000, "BOOKED");
  await raw.appointment.update({ where: { id: a0 }, data: { status: "NO_SHOW" } });
  await makeAppt(setup, caseId, dayOffset(5), setup.serviceFreeId, 200_000, "BOOKED");
  await repriceCase(caseId);

  const sibs = await raw.appointment.findMany({
    where: { medicalCaseId: caseId, NOT: { id: a0 } },
    select: { id: true, priceFinal: true },
  });
  record(
    "S11 NO_SHOW first → day5 priced as new first 200k",
    sibs[0]!.priceFinal === 200_000,
    `got ${sibs[0]!.priceFinal}`,
  );
  await cleanup(setup);
}

/**
 * S12: PAID-locked. If a Payment row in PAID status references the
 * appointment, recompute must NOT touch its priceFinal (would invalidate
 * cash already in the till).
 */
async function s12_paidLocked() {
  console.log("\n[S12] PAID-locked freeze");
  const setup = await setupFixture("S12");
  const caseId = await makeCase(setup, "S12");
  const a0 = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  // Stamp a PAID payment on the row.
  await raw.payment.create({
    data: {
      clinicId: setup.clinicId,
      patientId: setup.patientId,
      appointmentId: a0,
      amount: 200_000,
      currency: "UZS",
      method: "CASH",
      status: "PAID",
      paidAt: new Date(),
    },
  });
  await reprice(a0);
  // Now insert a backdated visit at Day -5 → would normally flip a0 to "repeat"
  // and zero its price. With PAID lock it must stay 200k.
  const aMinus5 = await makeAppt(setup, caseId, dayOffset(-5), setup.serviceFreeId, 200_000);
  await reprice(aMinus5);
  await repriceCase(caseId);

  const a0Row = await getApt(a0);
  record(
    "S12 PAID appointment is frozen — stays 200k even when displaced as first",
    a0Row.priceFinal === 200_000,
    `got ${a0Row.priceFinal}`,
  );
  await cleanup(setup);
}

/**
 * S13: case lifecycle — open → close (RESOLVED) → status stamp consistency.
 */
async function s13_caseLifecycle() {
  console.log("\n[S13] case lifecycle");
  const setup = await setupFixture("S13");
  const caseId = await makeCase(setup, "S13");
  await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  await makeAppt(setup, caseId, dayOffset(5), setup.serviceFreeId, 200_000);

  // Close the case.
  const closedAt = new Date();
  await raw.medicalCase.update({
    where: { id: caseId },
    data: { status: "RESOLVED", closedAt, closedReason: "test resolution" },
  });
  const closed = await raw.medicalCase.findUniqueOrThrow({ where: { id: caseId } });
  record("S13 closed case stamps closedAt", closed.closedAt !== null);
  record("S13 closed status RESOLVED", closed.status === "RESOLVED");

  // Re-open
  await raw.medicalCase.update({
    where: { id: caseId },
    data: { status: "OPEN", closedAt: null, closedReason: null },
  });
  const reopened = await raw.medicalCase.findUniqueOrThrow({ where: { id: caseId } });
  record("S13 reopened — closedAt cleared", reopened.closedAt === null);
  record("S13 reopened — status OPEN", reopened.status === "OPEN");

  await cleanup(setup);
}

/**
 * S14: detach-then-reattach round trip — pricing must converge.
 */
async function s14_detachReattach() {
  console.log("\n[S14] detach-then-reattach round trip");
  const setup = await setupFixture("S14");
  const caseId = await makeCase(setup, "S14");
  const a = await makeAppt(setup, caseId, dayOffset(0), setup.serviceFreeId, 200_000);
  const b = await makeAppt(setup, caseId, dayOffset(5), setup.serviceFreeId, 200_000);
  await repriceCase(caseId);
  const before = await getApt(b);
  record("S14.before B is free repeat", before.priceFinal === 0);

  // Detach B
  await raw.appointment.update({ where: { id: b }, data: { medicalCaseId: null } });
  await reprice(b);
  await repriceCase(caseId);
  const detached = await getApt(b);
  record("S14 detached B reverts to full price", detached.priceFinal === 200_000, `got ${detached.priceFinal}`);

  // Reattach
  await raw.appointment.update({ where: { id: b }, data: { medicalCaseId: caseId } });
  await reprice(b);
  await repriceCase(caseId);
  const reattached = await getApt(b);
  record("S14 reattached B back to free repeat", reattached.priceFinal === 0, `got ${reattached.priceFinal}`);

  // A is unaffected through the round trip.
  const aRow = await getApt(a);
  record("S14 A stays 200k throughout", aRow.priceFinal === 200_000);
  await cleanup(setup);
}

/**
 * S15: concurrent booking attempt at exact same slot. The DB-level EXCLUDE
 * constraint must reject the second insert.
 */
async function s15_concurrentBooking() {
  console.log("\n[S15] concurrent booking at exact slot");
  const setup = await setupFixture("S15");
  // Fire two creates at the SAME slot for the same doctor.
  const slot = dayOffset(20, 11, 30);
  const slotEnd = new Date(slot.getTime() + 30 * 60_000);
  const insertOne = () =>
    raw.appointment.create({
      data: {
        clinicId: setup.clinicId,
        patientId: setup.patientId,
        doctorId: setup.doctorId,
        cabinetId: setup.cabinetId,
        serviceId: setup.serviceFreeId,
        date: slot,
        time: "11:30",
        durationMin: 30,
        endDate: slotEnd,
        status: "BOOKED",
        queueStatus: "BOOKED",
        channel: "PHONE",
        priceService: 200_000,
        priceBase: 200_000,
        priceFinal: 200_000,
      },
    });

  const ok1 = await insertOne();
  let secondRejected = false;
  try {
    await insertOne();
  } catch (e: unknown) {
    secondRejected = true;
    const err = e as { message?: string };
    if (err.message?.includes("exclusion constraint") || err.message?.includes("Appointment_doctor_no_overlap")) {
      // expected
    }
  }
  record("S15 second concurrent booking rejected by DB", secondRejected);

  // Cleanup the row we just inserted.
  await raw.appointment.delete({ where: { id: ok1.id } });
  await cleanup(setup);
}

// ---------- run all ----------

async function purgeStressData() {
  // Wipe leftovers from previous runs so the doctor-overlap exclusion
  // constraint doesn't fight us.
  const patients = await raw.patient.findMany({
    where: { fullName: { startsWith: "STRESS::" } },
    select: { id: true },
  });
  if (patients.length === 0) return;
  const ids = patients.map((p) => p.id);
  // 1) services first need their join rows gone — appointmentService rows
  //    can reference STRESS services from non-STRESS appointments too in
  //    theory, so we delete by serviceId.
  const stressServices = await raw.service.findMany({
    where: { code: { startsWith: "STRESS_" } },
    select: { id: true },
  });
  const svcIds = stressServices.map((s) => s.id);
  await raw.appointmentService.deleteMany({
    where: {
      OR: [
        { appointment: { patientId: { in: ids } } },
        ...(svcIds.length ? [{ serviceId: { in: svcIds } }] : []),
      ],
    },
  });
  // 2) appointments referencing STRESS services as primary need to clear it.
  if (svcIds.length) {
    await raw.appointment.updateMany({
      where: { serviceId: { in: svcIds } },
      data: { serviceId: null },
    });
  }
  await raw.appointment.deleteMany({ where: { patientId: { in: ids } } });
  await raw.medicalCase.deleteMany({ where: { patientId: { in: ids } } });
  await raw.patient.deleteMany({ where: { id: { in: ids } } });
  await raw.service.deleteMany({ where: { code: { startsWith: "STRESS_" } } });
  console.log(`[purge] cleaned ${patients.length} stale stress patients`);
}

async function main() {
  console.log("==> stress-cases-scenarios — local DB");
  try {
    await purgeStressData();
    await s1_freeRepeatBoundary();
    await s2_cancelledFirst();
    await s3_cancelNoPropagate();
    await s4_perService();
    await s5_detachFirst();
    await s6_parallelCases();
    await s7_idempotency();
    await s8_discountStack();
    await s9_rescheduleFirstLater();
    await s10_backdatedCreate();
    await s11_noShowFirst();
    await s12_paidLocked();
    await s13_caseLifecycle();
    await s14_detachReattach();
    await s15_concurrentBooking();
  } catch (e) {
    console.error("scenario crashed:", e);
    process.exitCode = 1;
  }

  const tmpDir = path.resolve(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const md = [
    "# stress-cases-scenarios report",
    `Run: ${new Date().toISOString()}`,
    "",
    "| Scenario | Result | Detail |",
    "|---|---|---|",
    ...rows.map((r) => `| ${r.name} | ${r.ok ? "PASS" : "FAIL"} | ${r.detail ?? ""} |`),
  ].join("\n");
  fs.writeFileSync(path.join(tmpDir, "stress-cases-scenarios.md"), md, "utf8");
  const fails = rows.filter((r) => !r.ok).length;
  console.log(`\nReport: tmp/stress-cases-scenarios.md  PASS=${rows.length - fails}  FAIL=${fails}`);
  await raw.$disconnect();
  if (fails > 0) process.exit(2);
}

void main();
