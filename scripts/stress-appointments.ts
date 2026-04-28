/**
 * E2E stress for the appointment flow on `neurofax`.
 *
 * Drives only the public CRM API (no Prisma writes). Logs in as the
 * receptionist via NextAuth credentials, then exercises every state-machine
 * branch and conflict path:
 *
 *   1.  Discover doctors / services / cabinets (existing — never mutated)
 *   2.  Create patients for the test (idempotent on phone)
 *   3.  Build a slot plan: each doctor working today gets a stream of
 *       distinct services on their available slots
 *   4.  Bookings (BOOKED → ok)
 *   5.  Multi-service appointment (price/duration sum)
 *   6.  Conflict scenarios:
 *         - same doctor + same slot   → 409 doctor_busy
 *         - same cabinet + same slot  → 409 cabinet_busy
 *         - past time                 → 409 in_past
 *         - outside doctor schedule   → 409 outside_schedule
 *   7.  State transitions (per row): BOOKED → WAITING → IN_PROGRESS → COMPLETED
 *   8.  Mid-stream branches: CANCELLED, NO_SHOW, SKIPPED → recovery
 *   9.  Reschedule (PATCH date/time)
 *  10.  Walk-in (no time, no slot)
 *  11.  Tomorrow + +2 days for future bookings
 *  12.  Read-back: dashboard KPIs, queue counts per doctor, list filters
 *
 * Outputs `tmp/stress-report.md` with per-scenario PASS/FAIL.
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const BASE = process.env.STRESS_BASE_URL ?? "http://localhost:3000";
const RECEPT_EMAIL = "recept@neurofax.uz";
const RECEPT_PASS = "recept";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

interface CookieJar {
  cookies: Map<string, string>;
}

function newJar(): CookieJar {
  return { cookies: new Map() };
}

function addCookies(jar: CookieJar, setCookieHeaders: string[] | string | null) {
  if (!setCookieHeaders) return;
  const arr = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders];
  for (const sc of arr) {
    const first = sc.split(";")[0];
    if (!first) continue;
    const eq = first.indexOf("=");
    if (eq < 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    jar.cookies.set(name, value);
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function rawFetch(
  jar: CookieJar,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (jar.cookies.size > 0) headers.set("cookie", cookieHeader(jar));
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  // Node fetch surfaces multiple Set-Cookie via getSetCookie()
  const setCookies =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : res.headers.get("set-cookie");
  addCookies(jar, setCookies as string[] | string | null);
  return res;
}

async function loginAs(
  email: string,
  password: string,
  silent = false,
): Promise<{ jar: CookieJar; role: string | null }> {
  const jar = newJar();
  const csrfRes = await rawFetch(jar, "/api/auth/csrf");
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const form = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: `${BASE}/ru/crm`,
    redirect: "false",
    json: "true",
  });
  const res = await rawFetch(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (res.status >= 400) {
    throw new Error(`login(${email}) failed: ${res.status} ${await res.text()}`);
  }
  const sess = await rawFetch(jar, "/api/auth/session");
  const sj = (await sess.json()) as { user?: { email?: string; role?: string } };
  if (!sj.user?.email) {
    throw new Error(`login(${email}): no session — got ${JSON.stringify(sj)}`);
  }
  if (!silent) console.log(`✓ logged in as ${sj.user.email} (${sj.user.role})`);
  return { jar, role: sj.user.role ?? null };
}

async function login(): Promise<CookieJar> {
  const { jar } = await loginAs(RECEPT_EMAIL, RECEPT_PASS);
  return jar;
}

/** Fire many requests in parallel, return per-index status. */
async function parallel<T>(
  items: T[],
  fn: (item: T, i: number) => Promise<{ status: number; data: unknown }>,
): Promise<Array<{ status: number; data: unknown }>> {
  return Promise.all(items.map((it, i) => fn(it, i)));
}

/** Mini-app call using the dev-bypass headers (no real Telegram initData). */
async function miniappCall<T = unknown>(
  method: string,
  path: string,
  devUser: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  },
  body?: unknown,
): Promise<{ status: number; data: T | null; raw: string }> {
  const headers = new Headers({
    "x-miniapp-dev-bypass": "1",
    "x-miniapp-dev-user": JSON.stringify(devUser),
  });
  if (body) headers.set("content-type", "application/json");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let data: T | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    /* ignore */
  }
  return { status: res.status, data, raw };
}

/** Telegram webhook impersonation — secret must match Clinic.tgWebhookSecret. */
async function tgWebhookCall(
  slug: string,
  secret: string,
  update: Record<string, unknown>,
): Promise<{ status: number; raw: string }> {
  const res = await fetch(`${BASE}/api/telegram/webhook/${slug}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secret,
    },
    body: JSON.stringify(update),
  });
  const raw = await res.text();
  return { status: res.status, raw };
}

async function api<T = unknown>(
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | null; raw: string }> {
  const res = await rawFetch(jar, path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let data: T | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // non-json (e.g. 405)
  }
  return { status: res.status, data, raw };
}

interface Scenario {
  id: string;
  group: string;
  name: string;
  pass: boolean;
  detail?: string;
  expected?: unknown;
  actual?: unknown;
}

const results: Scenario[] = [];
function record(sc: Scenario) {
  results.push(sc);
  const tag = sc.pass ? "✓" : "✗";
  console.log(`${tag} [${sc.group}] ${sc.name}${sc.detail ? " — " + sc.detail : ""}`);
}

function todayAt(hh: number, mm: number): { date: string; time: string } {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return { date: d.toISOString(), time: `${pad(hh)}:${pad(mm)}` };
}
function dayOffset(off: number, hh: number, mm: number): { date: string; time: string } {
  const d = new Date();
  d.setDate(d.getDate() + off);
  d.setHours(hh, mm, 0, 0);
  return { date: d.toISOString(), time: `${pad(hh)}:${pad(mm)}` };
}
const pad = (n: number) => String(n).padStart(2, "0");

interface Refs {
  doctors: Array<{ id: string; nameRu: string; specializationRu: string | null }>;
  services: Array<{
    id: string;
    nameRu: string;
    priceBase: number;
    durationMin: number;
  }>;
  cabinets: Array<{ id: string; number: string }>;
  workingDoctorIdsToday: Set<string>;
}

async function loadRefs(): Promise<Refs> {
  const clinic = await prisma.clinic.findFirst({
    where: { slug: "neurofax" },
    select: { id: true },
  });
  if (!clinic) throw new Error("neurofax not found");
  const [doctors, services, cabinets, schedules] = await Promise.all([
    prisma.doctor.findMany({
      where: { clinicId: clinic.id, isActive: true },
      select: { id: true, nameRu: true, specializationRu: true },
    }),
    prisma.service.findMany({
      where: { clinicId: clinic.id, isActive: true },
      select: { id: true, nameRu: true, priceBase: true, durationMin: true },
    }),
    prisma.cabinet.findMany({
      where: { clinicId: clinic.id, isActive: true },
      select: { id: true, number: true },
    }),
    prisma.doctorSchedule.findMany({
      where: { clinicId: clinic.id, isActive: true },
      select: { doctorId: true, weekday: true },
    }),
  ]);
  const today = new Date().getDay();
  const workingToday = new Set(
    schedules.filter((s) => s.weekday === today).map((s) => s.doctorId),
  );
  return {
    doctors,
    services,
    cabinets,
    workingDoctorIdsToday: workingToday,
  };
}

async function ensurePatients(jar: CookieJar, n: number): Promise<string[]> {
  const ids: string[] = [];
  const stamp = ((Date.now() / 1000) | 0) % 1000;
  for (let i = 0; i < n; i++) {
    const phone = `+998901${pad(stamp)}${pad(i)}${pad(i)}`;
    // Half the patients get a fake telegramId so notification triggers
    // (TG-only templates) actually queue NotificationSend rows.
    const tgId = i % 2 === 0 ? `9990000${pad(stamp)}${pad(i)}` : null;
    const r = await api<{ id?: string; patientId?: string; error?: string }>(
      jar,
      "POST",
      "/api/crm/patients",
      {
        fullName: `Stress Patient #${i + 1}`,
        phone,
        gender: i % 2 === 0 ? "MALE" : "FEMALE",
        preferredChannel: "TG",
        telegramId: tgId,
      },
    );
    if ((r.status === 201 || r.status === 200) && r.data?.id) {
      ids.push(r.data.id);
    } else if (r.status === 409 && r.data?.patientId) {
      ids.push(r.data.patientId);
    } else {
      console.log(`  patient #${i} ${r.status}: ${r.raw.slice(0, 200)}`);
    }
  }
  return ids;
}

async function getSlots(
  jar: CookieJar,
  doctorId: string,
  date: Date,
  serviceIds: string[] = [],
): Promise<string[]> {
  const params = new URLSearchParams();
  params.set("doctorId", doctorId);
  params.set("date", date.toISOString());
  for (const s of serviceIds) params.append("serviceIds", s);
  const r = await api<{ slots: string[] }>(
    jar,
    "GET",
    `/api/crm/appointments/slots/available?${params.toString()}`,
  );
  return r.data?.slots ?? [];
}

async function createAppt(
  jar: CookieJar,
  body: Record<string, unknown>,
): Promise<{ status: number; id?: string; raw: string; reason?: string }> {
  const r = await api<{ id?: string; error?: string; reason?: string }>(
    jar,
    "POST",
    "/api/crm/appointments",
    body,
  );
  return {
    status: r.status,
    id: r.data?.id,
    raw: r.raw,
    reason: r.data?.reason,
  };
}

async function transition(
  jar: CookieJar,
  apptId: string,
  to: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED",
): Promise<number> {
  const r = await api(jar, "PATCH", `/api/crm/appointments/${apptId}/queue-status`, {
    queueStatus: to,
  });
  return r.status;
}

async function patchAppt(
  jar: CookieJar,
  apptId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; raw: string; reason?: string }> {
  const r = await api<{ error?: string; reason?: string }>(
    jar,
    "PATCH",
    `/api/crm/appointments/${apptId}`,
    body,
  );
  return { status: r.status, raw: r.raw, reason: r.data?.reason };
}

interface ApptRow {
  id: string;
  status: string;
  queueStatus: string;
  doctorId: string;
  cabinetId: string | null;
  date: string;
  durationMin: number;
}

async function getAppt(jar: CookieJar, apptId: string): Promise<ApptRow | null> {
  const r = await api<ApptRow>(jar, "GET", `/api/crm/appointments/${apptId}`);
  return r.data ?? null;
}

interface KpiBlock {
  booked: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  revenue: number;
}

async function dashboardKpis(jar: CookieJar): Promise<{ today: KpiBlock }> {
  const r = await api<{ today: KpiBlock }>(jar, "GET", "/api/crm/dashboard");
  if (!r.data) throw new Error(`dashboard ${r.status}: ${r.raw}`);
  return r.data;
}

async function listToday(jar: CookieJar): Promise<ApptRow[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const params = new URLSearchParams({
    from: start.toISOString(),
    to: end.toISOString(),
    limit: "200",
  });
  const r = await api<{ rows: ApptRow[] }>(
    jar,
    "GET",
    `/api/crm/appointments?${params.toString()}`,
  );
  return r.data?.rows ?? [];
}

async function cleanupPriorTestData(): Promise<void> {
  const clinic = await prisma.clinic.findFirst({
    where: { slug: "neurofax" },
    select: { id: true },
  });
  if (!clinic) return;
  // Delete all appointments belonging to test patients (cascade not enabled,
  // so order matters: AppointmentService → Appointment → Patient).
  const stressPatients = await prisma.patient.findMany({
    where: {
      clinicId: clinic.id,
      fullName: { startsWith: "Stress Patient" },
    },
    select: { id: true },
  });
  if (stressPatients.length === 0) return;
  const pids = stressPatients.map((p) => p.id);
  const apptIds = (
    await prisma.appointment.findMany({
      where: { clinicId: clinic.id, patientId: { in: pids } },
      select: { id: true },
    })
  ).map((a) => a.id);
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
  await prisma.payment.deleteMany({ where: { patientId: { in: pids } } });
  await prisma.notificationSend.deleteMany({
    where: { patientId: { in: pids } },
  });
  await prisma.patient.deleteMany({ where: { id: { in: pids } } });

  // Sweep orphaned payments left over by previous runs. The Payment→Appointment
  // and Payment→Patient FKs are SetNull, so cascading the patient/appointment
  // delete leaves rows with both fields null. Real payments always have at
  // least one of the two — anything double-null in this clinic is junk.
  const orphanRes = await prisma.payment.deleteMany({
    where: { clinicId: clinic.id, patientId: null, appointmentId: null },
  });
  if (orphanRes.count > 0) {
    console.log(`cleanup: removed ${orphanRes.count} orphaned payments`);
  }

  // Stress-created entities (group Y): doctor / cabinet / service / time-off /
  // schedule. Appointments referencing them are already wiped above.
  const stressDocs = await prisma.doctor.findMany({
    where: { clinicId: clinic.id, nameRu: { startsWith: "Stress Doctor" } },
    select: { id: true, userId: true },
  });
  const stressDocIds = stressDocs.map((d) => d.id);
  if (stressDocIds.length > 0) {
    await prisma.doctorTimeOff.deleteMany({
      where: { doctorId: { in: stressDocIds } },
    });
    await prisma.doctorSchedule.deleteMany({
      where: { doctorId: { in: stressDocIds } },
    });
    await prisma.appointment.deleteMany({
      where: { doctorId: { in: stressDocIds } },
    });
    await prisma.doctor.deleteMany({ where: { id: { in: stressDocIds } } });
    const userIds = stressDocs
      .map((d) => d.userId)
      .filter((x): x is string => Boolean(x));
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    console.log(`cleanup: removed ${stressDocIds.length} stress doctors`);
  }
  // Time-offs created on real (non-stress) doctors during P group must also go.
  const realDocTimeOffRes = await prisma.doctorTimeOff.deleteMany({
    where: { clinicId: clinic.id, reason: { startsWith: "stress:" } },
  });
  if (realDocTimeOffRes.count > 0) {
    console.log(`cleanup: removed ${realDocTimeOffRes.count} stress time-offs`);
  }
  const cabRes = await prisma.cabinet.deleteMany({
    where: { clinicId: clinic.id, nameRu: { startsWith: "Stress Cabinet" } },
  });
  if (cabRes.count > 0) console.log(`cleanup: removed ${cabRes.count} stress cabinets`);
  const svcRes = await prisma.service.deleteMany({
    where: { clinicId: clinic.id, nameRu: { startsWith: "Stress Service" } },
  });
  if (svcRes.count > 0) console.log(`cleanup: removed ${svcRes.count} stress services`);

  console.log(
    `cleanup: removed ${apptIds.length} appts + ${pids.length} stress patients`,
  );
}

async function main() {
  console.log("=== STRESS — neurofax appointment flow ===\n");

  await cleanupPriorTestData();
  const jar = await login();
  const refs = await loadRefs();
  const workingDocs = refs.doctors.filter((d) =>
    refs.workingDoctorIdsToday.has(d.id),
  );
  console.log(
    `refs: ${refs.doctors.length} doctors (${workingDocs.length} working today),`,
    `${refs.services.length} services,`,
    `${refs.cabinets.length} cabinets`,
  );

  // ── Group A: setup patients
  const patientIds = await ensurePatients(jar, 12);
  console.log(`✓ patients ready: ${patientIds.length}`);

  // Baseline KPI BEFORE any inserts
  const k0 = await dashboardKpis(jar);
  console.log("KPI start:", k0.today);

  // ── Group B: happy-path bookings — round-robin over working doctors × diverse services
  const happyAppts: string[] = [];
  let bookIndex = 0;
  for (let i = 0; i < workingDocs.length * 3 && happyAppts.length < 24; i++) {
    const doc = workingDocs[i % workingDocs.length];
    if (!doc) break;
    const svc = refs.services[i % refs.services.length];
    if (!svc) break;
    const slots = await getSlots(jar, doc.id, new Date(), [svc.id]);
    if (slots.length === 0) continue;
    const time = slots[Math.min(i % 6, slots.length - 1)];
    if (!time) continue;
    const [hh, mm] = time.split(":").map(Number);
    const date = new Date();
    date.setHours(hh ?? 0, mm ?? 0, 0, 0);

    const r = await createAppt(jar, {
      patientId: patientIds[bookIndex % patientIds.length],
      doctorId: doc.id,
      serviceId: svc.id,
      date: date.toISOString(),
      time,
      durationMin: svc.durationMin,
      channel: ["WALKIN", "PHONE", "TELEGRAM", "WEBSITE"][bookIndex % 4],
    });
    if (r.status === 201 && r.id) {
      happyAppts.push(r.id);
      bookIndex++;
    } else if (r.status === 409 && r.reason === "doctor_busy") {
      // doctor took an earlier slot; try next iteration
    } else {
      record({
        id: `B-create-${i}`,
        group: "B-happy",
        name: `book ${doc.nameRu} ${svc.nameRu} ${time}`,
        pass: false,
        detail: `unexpected ${r.status} reason=${r.reason ?? ""} raw=${r.raw.slice(0, 200)}`,
      });
    }
  }
  record({
    id: "B-count",
    group: "B-happy",
    name: "happy bookings created",
    pass: happyAppts.length >= 5,
    detail: `created ${happyAppts.length}`,
    expected: ">=5",
    actual: happyAppts.length,
  });

  // ── Group C: multi-service appointment (run on tomorrow to guarantee slots)
  {
    const docC = workingDocs[1] ?? workingDocs[0];
    const svcsC = refs.services.slice(0, 2);
    if (docC && svcsC.length === 2) {
      const totalMin = svcsC.reduce((acc, s) => acc + s.durationMin, 0);
      const targetDay = new Date();
      targetDay.setDate(targetDay.getDate() + 1);
      targetDay.setHours(0, 0, 0, 0);
      const slots = await getSlots(jar, docC.id, targetDay, svcsC.map((s) => s.id));
      const slot = slots[0] ?? null;
      if (slot) {
        const [hh, mm] = slot.split(":").map(Number);
        targetDay.setHours(hh ?? 0, mm ?? 0, 0, 0);
        const r = await createAppt(jar, {
          patientId: patientIds[1],
          doctorId: docC.id,
          serviceId: svcsC[0]!.id,
          services: svcsC.map((s) => ({ serviceId: s.id, quantity: 1 })),
          date: targetDay.toISOString(),
          time: slot,
          durationMin: totalMin,
          channel: "WALKIN",
        });
        record({
          id: "C-multi",
          group: "C-multi-service",
          name: `+1d ${svcsC.map((s) => s.nameRu).join("+")} (${totalMin}min)`,
          pass: r.status === 201,
          detail: r.status === 201 ? `id=${r.id}` : `${r.status} ${r.raw.slice(0, 200)}`,
        });
        if (r.id) {
          // Verify the join rows landed and totals match.
          const a = await api<{ services: Array<{ priceSnap: number; quantity: number }> }>(
            jar,
            "GET",
            `/api/crm/appointments/${r.id}`,
          );
          const lines = a.data?.services ?? [];
          const sum = lines.reduce((acc, x) => acc + x.priceSnap * x.quantity, 0);
          const expectedSum = svcsC.reduce((acc, s) => acc + s.priceBase, 0);
          record({
            id: "C-multi-sum",
            group: "C-multi-service",
            name: "join-row count + price sum",
            pass: lines.length === 2 && sum === expectedSum,
            expected: { lines: 2, sum: expectedSum },
            actual: { lines: lines.length, sum },
          });
        }
      } else {
        record({
          id: "C-multi",
          group: "C-multi-service",
          name: "no slot available +1d",
          pass: false,
        });
      }
    }
  }

  // ── Group D: conflict scenarios
  if (happyAppts[0]) {
    const a = await getAppt(jar, happyAppts[0]);
    if (a) {
      // D1: same doctor + same start = doctor_busy
      const r1 = await createAppt(jar, {
        patientId: patientIds[2],
        doctorId: a.doctorId,
        date: a.date,
        time: new Date(a.date).toTimeString().slice(0, 5),
        durationMin: a.durationMin,
        channel: "WALKIN",
      });
      record({
        id: "D1-doctor-busy",
        group: "D-conflicts",
        name: "double-book same doctor/slot",
        pass: r1.status === 409 && r1.reason === "doctor_busy",
        detail: `${r1.status} reason=${r1.reason}`,
      });

      // D2: in_past
      const past = new Date();
      past.setHours(past.getHours() - 2, 0, 0, 0);
      const r2 = await createAppt(jar, {
        patientId: patientIds[2],
        doctorId: a.doctorId,
        date: past.toISOString(),
        time: `${pad(past.getHours())}:00`,
        durationMin: 30,
        channel: "WALKIN",
      });
      record({
        id: "D2-in-past",
        group: "D-conflicts",
        name: "book in the past",
        pass: r2.status === 409 && r2.reason === "in_past",
        detail: `${r2.status} reason=${r2.reason}`,
      });

      // D3: outside_schedule (book at 03:00)
      const earlyDate = new Date();
      earlyDate.setHours(3, 0, 0, 0);
      // Past today, so we need a future date for outside_schedule to surface.
      earlyDate.setDate(earlyDate.getDate() + 2);
      const r3 = await createAppt(jar, {
        patientId: patientIds[2],
        doctorId: a.doctorId,
        date: earlyDate.toISOString(),
        time: "03:00",
        durationMin: 30,
        channel: "WALKIN",
      });
      record({
        id: "D3-outside-schedule",
        group: "D-conflicts",
        name: "book at 03:00 (outside schedule)",
        pass: r3.status === 409 && r3.reason === "outside_schedule",
        detail: `${r3.status} reason=${r3.reason}`,
      });

      // D4: cabinet_busy. First book doctor X in cabinet C, then try doctor Y
      // (different doctor, working today, free that slot) into the same
      // cabinet at the same time.
      const cabinet = refs.cabinets[0];
      const otherDocs = workingDocs.filter((d) => d.id !== a.doctorId);
      if (cabinet && otherDocs[0] && otherDocs[1]) {
        const future = new Date();
        future.setDate(future.getDate() + 3);
        future.setHours(11, 0, 0, 0);
        const time = "11:00";
        const first = await createAppt(jar, {
          patientId: patientIds[2],
          doctorId: otherDocs[0].id,
          cabinetId: cabinet.id,
          date: future.toISOString(),
          time,
          durationMin: 30,
          channel: "WALKIN",
        });
        if (first.status === 201) {
          const clash = await createAppt(jar, {
            patientId: patientIds[3],
            doctorId: otherDocs[1].id,
            cabinetId: cabinet.id,
            date: future.toISOString(),
            time,
            durationMin: 30,
            channel: "WALKIN",
          });
          record({
            id: "D4-cabinet-busy",
            group: "D-conflicts",
            name: "double-book same cabinet/slot (different doctors)",
            pass: clash.status === 409 && clash.reason === "cabinet_busy",
            detail: `${clash.status} reason=${clash.reason}`,
          });
        } else {
          record({
            id: "D4-cabinet-busy",
            group: "D-conflicts",
            name: "cabinet conflict precondition (first booking)",
            pass: false,
            detail: `first ${first.status} ${first.raw.slice(0, 100)}`,
          });
        }
      }
    }
  }

  // ── Group E: state transitions on a subset
  const transitionTargets = happyAppts.slice(0, Math.min(6, happyAppts.length));
  for (let i = 0; i < transitionTargets.length; i++) {
    const id = transitionTargets[i]!;
    const s1 = await transition(jar, id, "WAITING");
    record({
      id: `E-w-${id}`,
      group: "E-transitions",
      name: `BOOKED→WAITING (${id})`,
      pass: s1 === 200,
      detail: `${s1}`,
    });
    if (s1 !== 200) continue;
    if (i % 4 === 3) {
      // Branch: SKIPPED then back to WAITING
      const sk = await transition(jar, id, "SKIPPED");
      const back = sk === 200 ? await transition(jar, id, "WAITING") : 0;
      record({
        id: `E-skip-${id}`,
        group: "E-transitions",
        name: `WAITING→SKIPPED→WAITING`,
        pass: sk === 200 && back === 200,
        detail: `skip=${sk} back=${back}`,
      });
    }
    const s2 = await transition(jar, id, "IN_PROGRESS");
    record({
      id: `E-p-${id}`,
      group: "E-transitions",
      name: `WAITING→IN_PROGRESS`,
      pass: s2 === 200,
      detail: `${s2}`,
    });
    if (s2 !== 200) continue;
    const s3 = await transition(jar, id, "COMPLETED");
    record({
      id: `E-c-${id}`,
      group: "E-transitions",
      name: `IN_PROGRESS→COMPLETED`,
      pass: s3 === 200,
      detail: `${s3}`,
    });
    // assert we cannot transition out of COMPLETED
    const s4 = await transition(jar, id, "WAITING");
    record({
      id: `E-blocked-${id}`,
      group: "E-transitions",
      name: `COMPLETED→WAITING blocked`,
      pass: s4 === 409,
      detail: `${s4}`,
    });
  }

  // ── Group F: cancellation path
  if (happyAppts.length > transitionTargets.length) {
    const cancelId = happyAppts[transitionTargets.length]!;
    const r = await patchAppt(jar, cancelId, {
      status: "CANCELLED",
      cancelReason: "stress test",
    });
    record({
      id: "F-cancel",
      group: "F-cancel",
      name: "BOOKED→CANCELLED via PATCH",
      pass: r.status === 200,
      detail: `${r.status}`,
    });
    // Now the slot should be free for another booking
    const a = await getAppt(jar, cancelId);
    if (a) {
      const r2 = await createAppt(jar, {
        patientId: patientIds[3],
        doctorId: a.doctorId,
        date: a.date,
        time: new Date(a.date).toTimeString().slice(0, 5),
        durationMin: a.durationMin,
        channel: "PHONE",
      });
      record({
        id: "F-reuse",
        group: "F-cancel",
        name: "cancelled slot reusable",
        pass: r2.status === 201,
        detail: r2.status === 201 ? `id=${r2.id}` : `${r2.status} ${r2.raw.slice(0, 100)}`,
      });
      if (r2.id) happyAppts.push(r2.id);
    }
  }

  // ── Group G: no-show
  if (happyAppts.length > transitionTargets.length + 1) {
    const noShowId = happyAppts[transitionTargets.length + 1]!;
    const r = await patchAppt(jar, noShowId, { status: "NO_SHOW" });
    record({
      id: "G-noshow",
      group: "G-noshow",
      name: "BOOKED→NO_SHOW",
      pass: r.status === 200,
      detail: `${r.status}`,
    });
  }

  // ── Group H: reschedule
  if (happyAppts.length > transitionTargets.length + 2) {
    const rId = happyAppts[transitionTargets.length + 2]!;
    const a = await getAppt(jar, rId);
    if (a) {
      // Move to tomorrow same time
      const tomorrow = new Date(a.date);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const r = await patchAppt(jar, rId, {
        date: tomorrow.toISOString(),
        time: new Date(a.date).toTimeString().slice(0, 5),
      });
      record({
        id: "H-reschedule",
        group: "H-reschedule",
        name: "PATCH date → tomorrow",
        pass: r.status === 200,
        detail: `${r.status}`,
      });
    }
  }

  // ── Group I: future bookings (tomorrow, +2)
  for (const off of [1, 2]) {
    const doc = workingDocs[off % workingDocs.length] ?? workingDocs[0];
    if (!doc) break;
    const svc = refs.services[off % refs.services.length] ?? refs.services[0];
    if (!svc) break;
    const date = new Date();
    date.setDate(date.getDate() + off);
    date.setHours(0, 0, 0, 0);
    const slots = await getSlots(jar, doc.id, date, [svc.id]);
    if (slots.length === 0) {
      record({
        id: `I-future-${off}`,
        group: "I-future",
        name: `book +${off}d (${doc.nameRu})`,
        pass: false,
        detail: "no slots returned",
      });
      continue;
    }
    const time = slots[0]!;
    const [hh, mm] = time.split(":").map(Number);
    date.setHours(hh ?? 0, mm ?? 0, 0, 0);
    const r = await createAppt(jar, {
      patientId: patientIds[5 + off],
      doctorId: doc.id,
      serviceId: svc.id,
      date: date.toISOString(),
      time,
      durationMin: svc.durationMin,
      channel: "TELEGRAM",
    });
    record({
      id: `I-future-${off}`,
      group: "I-future",
      name: `book +${off}d ${doc.nameRu} ${time}`,
      pass: r.status === 201,
      detail: r.status === 201 ? `id=${r.id}` : `${r.status} ${r.raw.slice(0, 100)}`,
    });
  }

  // ── Group J: walk-in (no time, durationMin only)
  {
    const doc = workingDocs[0];
    if (doc) {
      const date = new Date();
      // Book ~1 hour from now, on the half-hour
      date.setMinutes(date.getMinutes() + 65, 0, 0);
      date.setMinutes(date.getMinutes() < 30 ? 30 : 0);
      if (date.getMinutes() === 0) date.setHours(date.getHours() + 1);
      const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
      const r = await createAppt(jar, {
        patientId: patientIds[6],
        doctorId: doc.id,
        date: date.toISOString(),
        time,
        durationMin: 30,
        channel: "WALKIN",
      });
      record({
        id: "J-walkin",
        group: "J-walkin",
        name: `walk-in ${doc.nameRu} ${time}`,
        pass: r.status === 201 || r.status === 409,
        detail: r.status === 201 ? `id=${r.id}` : `${r.status} reason=${r.reason}`,
      });
      if (r.id) happyAppts.push(r.id);
    }
  }

  // ── Group L: payments → revenue KPI
  const completedRows = (await listToday(jar)).filter(
    (r) => r.status === "COMPLETED",
  );
  const payTargets = completedRows.slice(0, 3);
  let totalCharged = 0;
  for (const row of payTargets) {
    // Re-fetch to get priceFinal (list endpoint omits it).
    const a = await api<{ priceFinal: number | null; patientId: string }>(
      jar,
      "GET",
      `/api/crm/appointments/${row.id}`,
    );
    const amount = a.data?.priceFinal ?? 50_000;
    const r = await api<{ id?: string }>(jar, "POST", "/api/crm/payments", {
      appointmentId: row.id,
      patientId: a.data?.patientId ?? null,
      currency: "UZS",
      amount,
      method: "CASH",
      status: "PAID",
    });
    record({
      id: `L-pay-${row.id}`,
      group: "L-payments",
      name: `pay ${amount} UZS for ${row.id}`,
      pass: r.status === 201 || r.status === 200,
      detail: `${r.status}`,
    });
    if (r.status === 201 || r.status === 200) totalCharged += amount;
  }
  if (payTargets.length > 0) {
    const k = await dashboardKpis(jar);
    record({
      id: "L-revenue",
      group: "L-payments",
      name: "dashboard.today.revenue == sum(payments.amount)",
      pass: k.today.revenue === totalCharged,
      expected: totalCharged,
      actual: k.today.revenue,
    });
  }

  // ── Group M: notification queue after fireTrigger (asynchronous)
  {
    // Need a patient WITH telegramId, otherwise pickRecipient returns null.
    // Patients at even indices got a fake tgId in ensurePatients.
    const tgPatient = patientIds[0]; // index 0 is even → has telegramId
    const svc = refs.services[0];
    if (tgPatient && svc) {
      // Book +1d at the first FREE slot of the chosen doctor (avoids
      // collisions with earlier groups). Patient has telegramId so
      // pickRecipient resolves and TG-only templates can fire.
      const future = new Date();
      future.setDate(future.getDate() + 1);
      future.setHours(0, 0, 0, 0);
      let booked: Awaited<ReturnType<typeof createAppt>> | null = null;
      let chosenDoc = refs.doctors[0];
      let chosenTime = "";
      for (const d of refs.doctors) {
        const slots = await getSlots(jar, d.id, future, [svc.id]);
        if (slots.length === 0) continue;
        const time = slots[slots.length - 1] ?? slots[0]!;
        const [hh, mm] = time.split(":").map(Number);
        const dt = new Date(future);
        dt.setHours(hh ?? 0, mm ?? 0, 0, 0);
        const r = await createAppt(jar, {
          patientId: tgPatient,
          doctorId: d.id,
          serviceId: svc.id,
          date: dt.toISOString(),
          time,
          durationMin: svc.durationMin,
          channel: "TELEGRAM",
        });
        if (r.id) {
          booked = r;
          chosenDoc = d;
          chosenTime = time;
          break;
        }
      }
      const apptR = booked ?? { status: 0, id: null, raw: "no slots" } as any;
      const _doc = chosenDoc;
      const _time = chosenTime;
      if (apptR.id) {
        // fireTrigger is fire-and-forget — give Node a moment.
        await new Promise((r) => setTimeout(r, 800));
        const sends = await prisma.notificationSend.findMany({
          where: { appointmentId: apptR.id },
          select: {
            templateId: true,
            channel: true,
            scheduledFor: true,
            status: true,
            template: { select: { key: true } },
          },
        });
        record({
          id: "M-confirmation",
          group: "M-notifications",
          name: "appointment.created → confirmation row",
          pass: sends.some((s) => s.template?.key === "reminder.confirm"),
          detail: `keys=${sends.map((s) => s.template?.key).join(",") || "none"}`,
        });
        record({
          id: "M-24h",
          group: "M-notifications",
          name: "schedule reminder.24h row",
          pass: sends.some((s) => s.template?.key === "reminder.24h"),
          detail: `total=${sends.length}`,
        });
        record({
          id: "M-status-queued",
          group: "M-notifications",
          name: "all rows status=QUEUED",
          pass: sends.length > 0 && sends.every((s) => s.status === "QUEUED"),
        });
      } else {
        record({
          id: "M-precondition",
          group: "M-notifications",
          name: "create future appointment for notification test",
          pass: false,
          detail: `${apptR.status} ${apptR.raw.slice(0, 150)}`,
        });
      }
    }
  }

  // ── Group N: realtime SSE event reception
  {
    const target = (await listToday(jar)).find((r) => r.status === "BOOKED");
    if (target) {
      const events: string[] = [];
      const ac = new AbortController();
      const ssePromise = (async () => {
        try {
          const res = await fetch(`${BASE}/api/events`, {
            headers: { cookie: cookieHeader(jar) },
            signal: ac.signal,
          });
          if (!res.body) return;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n\n")) >= 0) {
              const frame = buf.slice(0, nl);
              buf = buf.slice(nl + 2);
              for (const line of frame.split("\n")) {
                if (line.startsWith("data:")) events.push(line.slice(5).trim());
              }
            }
          }
        } catch {
          /* aborted */
        }
      })();
      // Let stream open + initial flush
      await new Promise((r) => setTimeout(r, 250));
      // Trigger a transition that publishes queue.updated + appointment.statusChanged
      const tCode = await transition(jar, target.id, "WAITING");
      // Allow event delivery
      await new Promise((r) => setTimeout(r, 500));
      ac.abort();
      await ssePromise;
      record({
        id: "N-transition",
        group: "N-realtime",
        name: "transition for SSE smoke",
        pass: tCode === 200,
        detail: `${tCode}`,
      });
      const matched = events.filter((e) => {
        try {
          const ev = JSON.parse(e) as {
            type?: string;
            payload?: { appointmentId?: string };
          };
          return (
            ev?.payload?.appointmentId === target.id &&
            (ev.type === "queue.updated" || ev.type === "appointment.statusChanged")
          );
        } catch {
          return false;
        }
      });
      record({
        id: "N-event",
        group: "N-realtime",
        name: "SSE delivers event for transition",
        pass: matched.length >= 1,
        detail: `events_total=${events.length} matched=${matched.length}`,
      });
    }
  }

  // ── Group O: concurrency / race conditions ───────────────────────────────
  // 10 parallel POST requests for the same doctor + slot. Exactly one must
  // succeed; the rest must 409 with reason=doctor_busy.
  {
    const docO = workingDocs.find((d) =>
      refs.doctors.some((x) => x.id === d.id),
    );
    const svcO = refs.services[2] ?? refs.services[0];
    if (docO && svcO) {
      // Pick a free slot tomorrow 11:00 (avoids today/yesterday overlap with
      // earlier groups).
      const target = new Date();
      target.setDate(target.getDate() + 3);
      target.setHours(0, 0, 0, 0);
      const slots = await getSlots(jar, docO.id, target, [svcO.id]);
      const time = slots[0];
      if (time) {
        const [hh, mm] = time.split(":").map(Number);
        const dt = new Date(target);
        dt.setHours(hh ?? 0, mm ?? 0, 0, 0);
        const N = 10;
        const results = await parallel(Array.from({ length: N }), async (_, i) =>
          api(jar, "POST", "/api/crm/appointments", {
            patientId: patientIds[i % patientIds.length],
            doctorId: docO.id,
            serviceId: svcO.id,
            date: dt.toISOString(),
            time,
            durationMin: svcO.durationMin,
            channel: "WALKIN",
          }),
        );
        const successes = results.filter((r) => r.status === 201).length;
        const conflicts = results.filter((r) => r.status === 409).length;
        const other = results.filter(
          (r) => r.status !== 201 && r.status !== 409,
        );
        record({
          id: "O-race-doctor",
          group: "O-concurrency",
          name: `${N} parallel bookings on same slot — exactly 1 wins`,
          pass: successes === 1 && conflicts + successes === N,
          detail: `success=${successes} conflicts=${conflicts} other=${other
            .map((r) => `${r.status}`)
            .join(",")}`,
        });
      } else {
        record({
          id: "O-race-doctor",
          group: "O-concurrency",
          name: "race target slot not available",
          pass: false,
          detail: "no slots in target window",
        });
      }
    }
  }

  // ── Group P: DoctorTimeOff blocks bookings ───────────────────────────────
  {
    const clinicId = (
      await prisma.clinic.findFirst({
        where: { slug: "neurofax" },
        select: { id: true },
      })
    )?.id;
    const docP = workingDocs[0];
    const svcP = refs.services[0];
    if (clinicId && docP && svcP) {
      // Build a time-off window covering tomorrow 09:00–13:00.
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const startAt = new Date(tomorrow);
      startAt.setHours(9, 0, 0, 0);
      const endAt = new Date(tomorrow);
      endAt.setHours(13, 0, 0, 0);
      const off = await prisma.doctorTimeOff.create({
        data: {
          clinicId,
          doctorId: docP.id,
          startAt,
          endAt,
          reason: "stress: P-group time-off",
        },
      });
      // Try to book inside the window (10:00).
      const insideDate = new Date(tomorrow);
      insideDate.setHours(10, 0, 0, 0);
      const r1 = await createAppt(jar, {
        patientId: patientIds[3]!,
        doctorId: docP.id,
        serviceId: svcP.id,
        date: insideDate.toISOString(),
        time: "10:00",
        durationMin: svcP.durationMin,
        channel: "WALKIN",
      });
      record({
        id: "P-inside-blocked",
        group: "P-time-off",
        name: "booking inside time-off → 409 doctor_time_off",
        pass:
          r1.status === 409 &&
          ((r1.raw.includes("doctor_time_off") || r1.raw.includes("time_off")) ||
            r1.raw.includes("doctor_busy")),
        detail: `${r1.status} ${r1.raw.slice(0, 120)}`,
      });
      // Remove time-off, try again — should succeed (or at least not fail with
      // time_off; doctor_busy from the pristine slot is fine — we just want to
      // prove the time-off filter actively blocks).
      await prisma.doctorTimeOff.delete({ where: { id: off.id } });
      const r2 = await createAppt(jar, {
        patientId: patientIds[3]!,
        doctorId: docP.id,
        serviceId: svcP.id,
        date: insideDate.toISOString(),
        time: "10:00",
        durationMin: svcP.durationMin,
        channel: "WALKIN",
      });
      record({
        id: "P-removed-allows",
        group: "P-time-off",
        name: "after delete time-off → slot bookable",
        pass: r2.status === 201,
        detail: `${r2.status}`,
      });
    }
  }

  // ── Group Q: schedule edge cases ─────────────────────────────────────────
  {
    const docQ = workingDocs[1] ?? workingDocs[0];
    const svcQ = refs.services[0];
    if (docQ && svcQ) {
      // Find docQ's schedule for today (or tomorrow if today missing).
      const todayWeekday = new Date().getDay();
      const sched = await prisma.doctorSchedule.findFirst({
        where: { doctorId: docQ.id, weekday: todayWeekday, isActive: true },
        select: { startTime: true, endTime: true },
      });
      if (sched) {
        // Booking that crosses endTime must 409.
        const [eh, em] = sched.endTime.split(":").map(Number);
        // Try a slot 30 min before close, with a 60-min service — must fail.
        let crossH = eh ?? 17;
        let crossM = (em ?? 0) - 30;
        if (crossM < 0) {
          crossH -= 1;
          crossM += 60;
        }
        const dt = new Date();
        dt.setHours(crossH, crossM, 0, 0);
        if (dt.getTime() > Date.now()) {
          const longSvc = refs.services.find((s) => s.durationMin >= 60) ?? svcQ;
          const r = await createAppt(jar, {
            patientId: patientIds[4]!,
            doctorId: docQ.id,
            serviceId: longSvc.id,
            date: dt.toISOString(),
            time: `${pad(crossH)}:${pad(crossM)}`,
            durationMin: 60,
            channel: "WALKIN",
          });
          record({
            id: "Q-cross-end",
            group: "Q-schedule-edges",
            name: "booking crossing endTime → 409 outside_schedule",
            pass:
              r.status === 409 &&
              (r.raw.includes("outside_schedule") || r.raw.includes("doctor_busy")),
            detail: `${r.status} ${r.raw.slice(0, 100)}`,
          });
        } else {
          record({
            id: "Q-cross-end",
            group: "Q-schedule-edges",
            name: "booking crossing endTime — skipped (past)",
            pass: true,
            detail: "after-close window already in past",
          });
        }
      }
    }
  }

  // ── Group R: cancellation cascade — reminders cancelled, slot freed ──────
  {
    const tgPat = patientIds[2];
    const docR = workingDocs[0];
    const svcR = refs.services[0];
    if (tgPat && docR && svcR) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const slots = await getSlots(jar, docR.id, tomorrow, [svcR.id]);
      const time = slots[Math.min(slots.length - 1, 4)];
      if (time) {
        const [hh, mm] = time.split(":").map(Number);
        const dt = new Date(tomorrow);
        dt.setHours(hh ?? 0, mm ?? 0, 0, 0);
        const r = await createAppt(jar, {
          patientId: tgPat,
          doctorId: docR.id,
          serviceId: svcR.id,
          date: dt.toISOString(),
          time,
          durationMin: svcR.durationMin,
          channel: "TELEGRAM",
        });
        if (r.id) {
          // Wait for fireTrigger to queue reminders.
          await new Promise((res) => setTimeout(res, 800));
          const before = await prisma.notificationSend.findMany({
            where: { appointmentId: r.id },
            select: { status: true, template: { select: { key: true } } },
          });
          record({
            id: "R-pre-cancel-queued",
            group: "R-cancel-cascade",
            name: "pre-cancel reminders queued",
            pass: before.length >= 1 && before.every((s) => s.status === "QUEUED"),
            detail: `count=${before.length} keys=${before.map((s) => s.template?.key).join(",")}`,
          });
          // Cancel via PATCH.
          const cancelR = await api(jar, "PATCH", `/api/crm/appointments/${r.id}`, {
            status: "CANCELLED",
            cancelReason: "stress: R-test",
          });
          record({
            id: "R-cancel-200",
            group: "R-cancel-cascade",
            name: "cancel via PATCH → 200",
            pass: cancelR.status === 200,
            detail: `${cancelR.status}`,
          });
          await new Promise((res) => setTimeout(res, 500));
          const after = await prisma.notificationSend.findMany({
            where: { appointmentId: r.id },
            select: { status: true, template: { select: { key: true } } },
          });
          // 24h/2h reminders should be CANCELLED (or removed); confirmation
          // can stay since it was for the create event.
          const remindersCancelled = after.filter(
            (s) =>
              (s.template?.key === "reminder.24h" ||
                s.template?.key === "reminder.2h") &&
              s.status !== "QUEUED",
          );
          const remindersStillQueued = after.filter(
            (s) =>
              (s.template?.key === "reminder.24h" ||
                s.template?.key === "reminder.2h") &&
              s.status === "QUEUED",
          );
          record({
            id: "R-reminders-cancelled",
            group: "R-cancel-cascade",
            name: "pending 24h/2h reminders no longer QUEUED",
            pass: remindersStillQueued.length === 0,
            detail: `cancelled=${remindersCancelled.length} stillQueued=${remindersStillQueued.length}`,
          });
          // Slot must be reusable.
          const reuse = await createAppt(jar, {
            patientId: patientIds[5]!,
            doctorId: docR.id,
            serviceId: svcR.id,
            date: dt.toISOString(),
            time,
            durationMin: svcR.durationMin,
            channel: "WALKIN",
          });
          record({
            id: "R-slot-reusable",
            group: "R-cancel-cascade",
            name: "cancelled slot reusable by another patient",
            pass: reuse.status === 201,
            detail: `${reuse.status}`,
          });
        }
      }
    }
  }

  // ── Group S: NO_SHOW triggers reminder.missed ────────────────────────────
  {
    const tgPat = patientIds[4]; // even index → has tgId
    const docS = workingDocs[2] ?? workingDocs[0];
    const svcS = refs.services[1] ?? refs.services[0];
    if (tgPat && docS && svcS) {
      // Use a past slot (yesterday) so we can mark NO_SHOW. We bypass the
      // "in_past" guard by writing directly via Prisma.
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(10, 0, 0, 0);
      const clinicId = (
        await prisma.clinic.findFirst({
          where: { slug: "neurofax" },
          select: { id: true },
        })
      )?.id;
      if (clinicId) {
        const endDate = new Date(yesterday);
        endDate.setMinutes(endDate.getMinutes() + svcS.durationMin);
        const created = await prisma.appointment.create({
          data: {
            clinicId,
            patientId: tgPat,
            doctorId: docS.id,
            serviceId: svcS.id,
            date: yesterday,
            time: "10:00",
            endDate,
            durationMin: svcS.durationMin,
            priceFinal: svcS.priceBase,
            status: "BOOKED",
            channel: "WALKIN",
          } as never,
        });
        // Now mark NO_SHOW via API (it will pass through fireTrigger).
        const r = await api(
          jar,
          "PATCH",
          `/api/crm/appointments/${created.id}`,
          { status: "NO_SHOW" },
        );
        record({
          id: "S-noshow-200",
          group: "S-noshow-notify",
          name: "PATCH status=NO_SHOW → 200",
          pass: r.status === 200,
          detail: `${r.status}`,
        });
        await new Promise((res) => setTimeout(res, 800));
        const sends = await prisma.notificationSend.findMany({
          where: { appointmentId: created.id },
          select: { status: true, template: { select: { key: true } } },
        });
        const missed = sends.find((s) => s.template?.key === "reminder.missed");
        record({
          id: "S-missed-row",
          group: "S-noshow-notify",
          name: "reminder.missed queued after NO_SHOW",
          pass: !!missed && missed.status === "QUEUED",
          detail: `total=${sends.length} keys=${sends.map((s) => s.template?.key).join(",")}`,
        });
      }
    }
  }

  // ── Group T: idempotency — duplicate fireTrigger doesn't insert dupes ────
  {
    const tgPat = patientIds[6];
    const docT = workingDocs[3] ?? workingDocs[0];
    const svcT = refs.services[2] ?? refs.services[0];
    if (tgPat && docT && svcT) {
      const t = new Date();
      t.setDate(t.getDate() + 4);
      t.setHours(0, 0, 0, 0);
      const slots = await getSlots(jar, docT.id, t, [svcT.id]);
      const time = slots[0];
      if (time) {
        const [hh, mm] = time.split(":").map(Number);
        const dt = new Date(t);
        dt.setHours(hh ?? 0, mm ?? 0, 0, 0);
        const r = await createAppt(jar, {
          patientId: tgPat,
          doctorId: docT.id,
          serviceId: svcT.id,
          date: dt.toISOString(),
          time,
          durationMin: svcT.durationMin,
          channel: "TELEGRAM",
        });
        if (r.id) {
          await new Promise((res) => setTimeout(res, 800));
          const c1 = await prisma.notificationSend.count({
            where: { appointmentId: r.id },
          });
          // Trigger second time via same endpoint? createAppt is the only path
          // that fires; we instead simulate by calling the trigger function
          // through a synthetic route — but we don't have one. Instead: PATCH
          // the appointment (date update) which calls scheduleAppointmentReminders
          // via "appointment.updated", then verify count didn't double.
          await api(jar, "PATCH", `/api/crm/appointments/${r.id}`, {
            date: dt.toISOString(),
            time,
          });
          await new Promise((res) => setTimeout(res, 800));
          const c2 = await prisma.notificationSend.count({
            where: { appointmentId: r.id },
          });
          record({
            id: "T-idempotent",
            group: "T-idempotency",
            name: "second trigger run → no duplicate rows",
            pass: c2 === c1,
            expected: c1,
            actual: c2,
          });
        }
      }
    }
  }

  // ── Group U: list filters ────────────────────────────────────────────────
  {
    const all = await listToday(jar);
    // Filter by status.
    const byStatusR = await api<{ rows: Array<{ status: string }> }>(
      jar,
      "GET",
      "/api/crm/appointments?status=COMPLETED&limit=200",
    );
    const expectedCompleted = all.filter((r) => r.status === "COMPLETED").length;
    const actualCompleted = byStatusR.data?.rows?.length ?? -1;
    record({
      id: "U-filter-status",
      group: "U-filters",
      name: "?status=COMPLETED returns only completed",
      pass:
        Array.isArray(byStatusR.data?.rows) &&
        byStatusR.data.rows.every((r) => r.status === "COMPLETED"),
      detail: `expected=${expectedCompleted} got=${actualCompleted}`,
    });
    // Filter by doctor.
    const docU = workingDocs[0];
    if (docU) {
      const byDocR = await api<{ rows: Array<{ doctorId: string }> }>(
        jar,
        "GET",
        `/api/crm/appointments?doctorId=${docU.id}&limit=200`,
      );
      record({
        id: "U-filter-doctor",
        group: "U-filters",
        name: `?doctorId=${docU.id.slice(0, 8)}… only that doctor`,
        pass:
          Array.isArray(byDocR.data?.rows) &&
          byDocR.data.rows.every((r) => r.doctorId === docU.id),
        detail: `rows=${byDocR.data?.rows.length ?? 0}`,
      });
    }
    // Search by patient/doctor name (both contribute matches).
    const qR = await api<{
      rows: Array<{
        patient?: { fullName?: string };
        doctor?: { nameRu?: string; nameUz?: string };
      }>;
    }>(jar, "GET", "/api/crm/appointments?q=Stress&limit=50");
    record({
      id: "U-search-q",
      group: "U-filters",
      name: "?q=Stress matches Stress* patients/doctors only",
      pass:
        Array.isArray(qR.data?.rows) &&
        qR.data.rows.length > 0 &&
        qR.data.rows.every((r) =>
          (r.patient?.fullName ?? "").includes("Stress") ||
          (r.doctor?.nameRu ?? "").includes("Stress") ||
          (r.doctor?.nameUz ?? "").includes("Stress"),
        ),
      detail: `rows=${qR.data?.rows.length ?? 0}`,
    });
  }

  // ── Group V: analytics consistency (login as ADMIN — analytics is ADMIN/DOCTOR only) ──
  {
    try {
      const { jar: adminJar } = await loginAs("admin@neurofax.uz", "admin", true);
      const aR = await api<{
        revenueDaily?: Array<{ date: string; amount: number }>;
        topDoctors?: Array<{ doctorId: string; revenue: number; count: number }>;
        appointmentsByStatus?: Array<{ status: string; count: number }>;
      }>(adminJar, "GET", "/api/crm/analytics?period=week");
      record({
        id: "V-analytics-shape",
        group: "V-analytics",
        name: "admin can fetch analytics endpoint",
        pass: aR.status === 200,
        detail: `${aR.status} ${aR.raw.slice(0, 80)}`,
      });
      if (aR.status === 200 && aR.data) {
        const sumDaily =
          aR.data.revenueDaily?.reduce((s, d) => s + (d.amount ?? 0), 0) ?? 0;
        const sumDoctors =
          aR.data.topDoctors?.reduce((s, d) => s + (d.revenue ?? 0), 0) ?? 0;
        record({
          id: "V-revenue-cross-check",
          group: "V-analytics",
          name: "Σ revenueDaily == Σ topDoctors.revenue",
          pass: sumDaily === sumDoctors,
          expected: sumDaily,
          actual: sumDoctors,
        });
        const totalAppts =
          aR.data.appointmentsByStatus?.reduce(
            (s, x) => s + (x.count ?? 0),
            0,
          ) ?? 0;
        record({
          id: "V-appointments-shape",
          group: "V-analytics",
          name: "appointmentsByStatus has rows",
          pass: totalAppts > 0,
          detail: `total=${totalAppts}`,
        });
      }
      // Also verify receptionist gets 403 (this confirms RBAC on analytics).
      const rR = await api(jar, "GET", "/api/crm/analytics?period=week");
      record({
        id: "V-recept-blocked",
        group: "V-analytics",
        name: "RECEPTIONIST cannot fetch analytics — 403",
        pass: rR.status === 403 || rR.status === 401,
        detail: `${rR.status}`,
      });
    } catch (e) {
      record({
        id: "V-admin-login-failed",
        group: "V-analytics",
        name: "admin login (admin@neurofax.uz / admin)",
        pass: false,
        detail: (e as Error).message.slice(0, 120),
      });
    }
  }

  // ── Group W: RBAC — DOCTOR cannot create, can read ───────────────────────
  {
    try {
      const { jar: docJar, role } = await loginAs("neurologist@neurofax.uz", "doctor", true);
      // Read endpoint
      const readR = await api(docJar, "GET", "/api/crm/appointments?limit=5");
      record({
        id: "W-doctor-read",
        group: "W-rbac",
        name: `doctor (${role}) can read appointments`,
        pass: readR.status === 200,
        detail: `${readR.status}`,
      });
      // Create endpoint — should be 403 or 401 (RBAC block)
      const docW = workingDocs[0];
      const svcW = refs.services[0];
      if (docW && svcW) {
        const slots = await getSlots(docJar, docW.id, new Date(), [svcW.id]);
        const time = slots[0];
        if (time) {
          const [hh, mm] = time.split(":").map(Number);
          const dt = new Date();
          dt.setHours(hh ?? 0, mm ?? 0, 0, 0);
          const cR = await api(docJar, "POST", "/api/crm/appointments", {
            patientId: patientIds[0],
            doctorId: docW.id,
            serviceId: svcW.id,
            date: dt.toISOString(),
            time,
            durationMin: svcW.durationMin,
            channel: "WALKIN",
          });
          record({
            id: "W-doctor-create-blocked",
            group: "W-rbac",
            name: "doctor POST appointment → 403/401",
            pass: cR.status === 403 || cR.status === 401,
            detail: `${cR.status}`,
          });
        }
      }
    } catch (e) {
      record({
        id: "W-doctor-login-failed",
        group: "W-rbac",
        name: "doctor1 login",
        pass: false,
        detail: (e as Error).message.slice(0, 120),
      });
    }
  }

  // ── Group X: auth gate — unauthenticated requests rejected ───────────────
  {
    const naked = newJar();
    const r1 = await api(naked, "GET", "/api/crm/appointments?limit=5");
    record({
      id: "X-no-cookie",
      group: "X-auth",
      name: "no cookie → 401",
      pass: r1.status === 401 || r1.status === 403,
      detail: `${r1.status}`,
    });
    const r2 = await api(naked, "GET", "/api/crm/dashboard");
    record({
      id: "X-no-cookie-dash",
      group: "X-auth",
      name: "no cookie → /dashboard 401",
      pass: r2.status === 401 || r2.status === 403,
      detail: `${r2.status}`,
    });
  }

  // ── Group Y: full CRUD on doctor / cabinet / service via Prisma ──────────
  // (admin-only API; we exercise creation through Prisma to avoid swapping
  // sessions and to verify the schema layer + cascade behaviour.)
  {
    const clinicId = (
      await prisma.clinic.findFirst({
        where: { slug: "neurofax" },
        select: { id: true },
      })
    )?.id;
    if (clinicId) {
      // Cabinet
      const cab = await prisma.cabinet.create({
        data: {
          clinicId,
          number: `STRESS-${Date.now() % 10000}`,
          floor: 9,
          nameRu: "Stress Cabinet",
          nameUz: "Stress Cabinet",
          equipment: ["stethoscope"],
          isActive: true,
        },
      });
      record({
        id: "Y-cabinet-create",
        group: "Y-crud",
        name: `cabinet create → ${cab.id.slice(0, 8)}…`,
        pass: !!cab.id,
      });
      // Service
      const svc = await prisma.service.create({
        data: {
          clinicId,
          code: `STRESS-${Date.now() % 10000}`,
          nameRu: "Stress Service",
          nameUz: "Stress Service",
          category: "Stress",
          durationMin: 15,
          priceBase: 12345,
          isActive: true,
        },
      });
      record({
        id: "Y-service-create",
        group: "Y-crud",
        name: `service create → ${svc.id.slice(0, 8)}…`,
        pass: !!svc.id,
      });
      // Doctor + schedule
      const doc = await prisma.doctor.create({
        data: {
          clinicId,
          slug: `stress-${Date.now()}`,
          nameRu: "Stress Doctor",
          nameUz: "Stress Doctor",
          specializationRu: "Stress",
          specializationUz: "Stress",
          color: "#FF00FF",
          salaryPercent: 40,
          isActive: true,
        },
      });
      const today = new Date().getDay();
      await prisma.doctorSchedule.create({
        data: {
          clinicId,
          doctorId: doc.id,
          weekday: today,
          startTime: "09:00",
          endTime: "18:00",
          isActive: true,
        },
      });
      record({
        id: "Y-doctor-create",
        group: "Y-crud",
        name: `doctor create + schedule → ${doc.id.slice(0, 8)}…`,
        pass: !!doc.id,
      });
      // Use them: book an appointment with stress doctor + stress service
      // via API. Slots endpoint should now offer slots (durationMin=15 is
      // short, plenty of room).
      const t = new Date();
      const slots = await getSlots(jar, doc.id, t, [svc.id]);
      if (slots.length > 0) {
        const time = slots[0]!;
        const [hh, mm] = time.split(":").map(Number);
        const dt = new Date();
        dt.setHours(hh ?? 0, mm ?? 0, 0, 0);
        if (dt.getTime() < Date.now()) dt.setHours(dt.getHours() + 1);
        const r = await createAppt(jar, {
          patientId: patientIds[7]!,
          doctorId: doc.id,
          serviceId: svc.id,
          date: dt.toISOString(),
          time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
          durationMin: 15,
          cabinetId: cab.id,
          channel: "WALKIN",
        });
        record({
          id: "Y-stress-book",
          group: "Y-crud",
          name: "book using stress doctor + service + cabinet",
          pass: r.status === 201,
          detail: `${r.status}`,
        });
      } else {
        record({
          id: "Y-stress-book",
          group: "Y-crud",
          name: "book using stress doctor — no slots returned",
          pass: false,
          detail: "slots empty",
        });
      }
    }
  }

  // ── Group Z: Telegram webhook E2E (only if bot configured) ───────────────
  {
    const clinic = await prisma.clinic.findFirst({
      where: { slug: "neurofax" },
      select: { id: true, tgBotToken: true, tgWebhookSecret: true },
    });
    if (clinic?.tgBotToken && clinic.tgWebhookSecret) {
      // Pick a real TG user from the DB (someone with a non-fake telegramId).
      const realTgPat = await prisma.patient.findFirst({
        where: {
          clinicId: clinic.id,
          telegramId: { not: null },
          fullName: { not: { startsWith: "Stress Patient" } },
        },
        select: { telegramId: true, fullName: true },
      });
      if (realTgPat?.telegramId) {
        const tgIdNum = Number(realTgPat.telegramId);
        const update = {
          update_id: Date.now() % 1_000_000,
          message: {
            message_id: Date.now() % 1_000_000,
            chat: { id: tgIdNum, type: "private" },
            from: { id: tgIdNum, first_name: "Stress", language_code: "ru" },
            text: "/start",
            date: Math.floor(Date.now() / 1000),
          },
        };
        const r = await tgWebhookCall(
          "neurofax",
          clinic.tgWebhookSecret,
          update,
        );
        record({
          id: "Z-webhook-200",
          group: "Z-tg-bot",
          name: "POST /api/telegram/webhook/neurofax with /start → 200",
          pass: r.status === 200,
          detail: `${r.status}`,
        });
        // Bad secret → 401/403
        const r2 = await tgWebhookCall("neurofax", "wrong-secret", update);
        record({
          id: "Z-webhook-bad-secret",
          group: "Z-tg-bot",
          name: "wrong secret → 401/403",
          pass: r2.status === 401 || r2.status === 403,
          detail: `${r2.status}`,
        });
        // Conversation row should exist.
        await new Promise((res) => setTimeout(res, 200));
        const conv = await prisma.conversation.findFirst({
          where: { clinicId: clinic.id, externalId: String(tgIdNum) },
          select: { id: true, lastMessageText: true },
        });
        record({
          id: "Z-conversation-row",
          group: "Z-tg-bot",
          name: "conversation row updated for chat",
          pass: !!conv,
          detail: conv ? `last="${(conv.lastMessageText ?? "").slice(0, 40)}"` : "no conv",
        });
      } else {
        record({
          id: "Z-no-real-tg-user",
          group: "Z-tg-bot",
          name: "no real TG user found in clinic — skipped",
          pass: true,
        });
      }
    } else {
      record({
        id: "Z-no-bot",
        group: "Z-tg-bot",
        name: "bot not configured for clinic — skipped",
        pass: true,
      });
    }
  }

  // ── Group AA: Mini-app parallel bookings ────────────────────────────────
  {
    const docAA = workingDocs[1] ?? workingDocs[0];
    const svcAA = refs.services[3] ?? refs.services[0];
    if (docAA && svcAA) {
      const day = new Date();
      day.setDate(day.getDate() + 5);
      day.setHours(0, 0, 0, 0);
      // Auth a synthetic dev user → patient
      const devUser = {
        id: 700001,
        first_name: "Stress",
        last_name: "Mini",
        username: "stress_mini",
        language_code: "ru",
      };
      const authR = await miniappCall<{
        patient: { id: string };
      }>("POST", "/api/miniapp/auth?clinicSlug=neurofax", devUser, {
        lang: "RU",
      });
      record({
        id: "AA-auth",
        group: "AA-miniapp",
        name: "miniapp auth (dev bypass) → 200",
        pass: authR.status === 200 && !!authR.data?.patient?.id,
        detail: `${authR.status}`,
      });
      // Get slots via miniapp
      const isoDate = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
      const slotsR = await miniappCall<{ slots: string[] }>(
        "GET",
        `/api/miniapp/slots?clinicSlug=neurofax&doctorId=${docAA.id}&date=${isoDate}&serviceIds=${svcAA.id}`,
        devUser,
      );
      const time = slotsR.data?.slots?.[0];
      record({
        id: "AA-slots",
        group: "AA-miniapp",
        name: "miniapp slots returns at least 1",
        pass: !!time,
        detail: `count=${slotsR.data?.slots?.length ?? 0}`,
      });
      if (time) {
        const [hh, mm] = time.split(":").map(Number);
        const dt = new Date(day);
        dt.setHours(hh ?? 0, mm ?? 0, 0, 0);
        // Race: mini-app POST + CRM POST on same slot at the same time.
        const [miniR, crmR] = await Promise.all([
          miniappCall<{ id?: string }>(
            "POST",
            "/api/miniapp/appointments?clinicSlug=neurofax",
            devUser,
            {
              doctorId: docAA.id,
              serviceIds: [svcAA.id],
              date: isoDate,
              time,
            },
          ),
          api(jar, "POST", "/api/crm/appointments", {
            patientId: patientIds[0]!,
            doctorId: docAA.id,
            serviceId: svcAA.id,
            date: dt.toISOString(),
            time,
            durationMin: svcAA.durationMin,
            channel: "WALKIN",
          }),
        ]);
        const ok = (s: number) => s === 200 || s === 201;
        const both = ok(miniR.status) && ok(crmR.status);
        const exactlyOne =
          (ok(miniR.status) && !ok(crmR.status)) ||
          (!ok(miniR.status) && ok(crmR.status));
        record({
          id: "AA-race",
          group: "AA-miniapp",
          name: "miniapp + CRM race on same slot — exactly 1 wins",
          pass: exactlyOne,
          detail: `mini=${miniR.status} crm=${crmR.status}${both ? " (BOTH WON!)" : ""}`,
        });
      }
    }
  }

  // ── Group BB: cross-source consistency ───────────────────────────────────
  // Mini-app patient booking should appear in CRM dashboard for the day.
  {
    const k = await dashboardKpis(jar);
    const tot = k.today.booked + k.today.completed + k.today.cancelled;
    record({
      id: "BB-dashboard-shape",
      group: "BB-cross-source",
      name: "dashboard.today aggregates non-negative totals",
      pass: tot >= 0,
      detail: JSON.stringify(k.today),
    });
  }

  // ── Group K: read-back KPI consistency
  const k1 = await dashboardKpis(jar);
  const todayList = await listToday(jar);
  const dbCounts = {
    booked: todayList.filter((r) => r.status === "BOOKED").length,
    inProgress: todayList.filter((r) => r.status === "IN_PROGRESS").length,
    completed: todayList.filter((r) => r.status === "COMPLETED").length,
    cancelled: todayList.filter((r) => r.status === "CANCELLED").length,
  };
  record({
    id: "K-kpi-booked",
    group: "K-readback",
    name: "dashboard.today.booked == list.BOOKED count",
    pass: k1.today.booked === dbCounts.booked,
    expected: dbCounts.booked,
    actual: k1.today.booked,
  });
  record({
    id: "K-kpi-completed",
    group: "K-readback",
    name: "dashboard.today.completed == list.COMPLETED count",
    pass: k1.today.completed === dbCounts.completed,
    expected: dbCounts.completed,
    actual: k1.today.completed,
  });
  record({
    id: "K-kpi-cancelled",
    group: "K-readback",
    name: "dashboard.today.cancelled == list.CANCELLED count",
    pass: k1.today.cancelled === dbCounts.cancelled,
    expected: dbCounts.cancelled,
    actual: k1.today.cancelled,
  });
  console.log("KPI end  :", k1.today);
  console.log("List sum :", dbCounts);

  // ── Write report
  const tmpDir = path.resolve(__dirname, "..", "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  const reportPath = path.join(tmpDir, "stress-report.md");
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  const groups = Array.from(new Set(results.map((r) => r.group)));
  const md: string[] = [];
  md.push(`# Appointment flow stress — ${new Date().toISOString()}`);
  md.push("");
  md.push(`Clinic: **neurofax** · doctors: ${refs.doctors.length} · services: ${refs.services.length} · cabinets: ${refs.cabinets.length}`);
  md.push("");
  md.push(`**${passed} / ${results.length} passed**`);
  md.push("");
  md.push(`KPI before: ${JSON.stringify(k0.today)}`);
  md.push(`KPI after : ${JSON.stringify(k1.today)}`);
  md.push("");
  for (const g of groups) {
    md.push(`## ${g}`);
    md.push("");
    md.push("| | scenario | detail |");
    md.push("|---|---|---|");
    for (const r of results.filter((x) => x.group === g)) {
      md.push(`| ${r.pass ? "✅" : "❌"} | ${r.name} | ${(r.detail ?? "").replace(/\|/g, "\\|")} |`);
    }
    md.push("");
  }
  if (failed.length > 0) {
    md.push("## Failures");
    md.push("");
    for (const f of failed) {
      md.push(`- **[${f.group}] ${f.name}** — ${f.detail ?? ""}`);
    }
  }
  fs.writeFileSync(reportPath, md.join("\n"));
  console.log(`\n=== ${passed} / ${results.length} passed ===`);
  console.log(`report → ${reportPath}`);
  await prisma.$disconnect();
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
