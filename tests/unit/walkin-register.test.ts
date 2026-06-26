/**
 * Tests for `src/server/appointments/registerWalkin` — the single queue-insertion
 * path shared by the public kiosk (`/api/c/[slug]/queue/walkin`) and the CRM
 * front desk (`/api/crm/appointments/walkin`). If this kernel drifts, the board,
 * kiosk, and patient ticket disagree, so it earns thorough coverage.
 *
 * Strategy (mirrors confirm-appointment.test.ts): vi.mock the DB / RNG / realtime
 * collaborators with stateful in-memory stubs, and let the PURE helpers run for
 * real so the test exercises the genuine composition:
 *   - real `normalizePhone` / `phoneSearchVariants` (find-or-create matching)
 *   - real `tashkentComponents` (the Tashkent wall-clock display column — guards
 *     the −5h UTC-skew bug the old kiosk had)
 *   - real `allocateQueueOrder` (aggregate max → +1) running inside the real
 *     `runQueueTx` (Serializable + write-conflict retry), both driven by the
 *     mocked prisma's `appointment.aggregate` / `$transaction`.
 *
 * Only the leaf collaborators are stubbed: `@/lib/prisma`,
 * `@/server/realtime/publish`, `@/server/services/patient-number`
 * (allocatePatientNumber), and `@/server/appointments/ticket-code`
 * (generateTicketCode → deterministic code).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ticketNumberFor } from "@/server/services/ticket-number";
import { tashkentComponents } from "@/lib/booking-validation";

// Frozen "now" so the display time, day bounds, and durations are deterministic.
// 08:30 UTC → 13:30 Tashkent (UTC+5): the gap between the two is exactly the
// bug the kernel's `tashkentComponents` call exists to prevent.
const FROZEN_UTC = "2026-06-26T08:30:00.000Z";
const TASHKENT_TIME = "13:30";

// ----- types ----------------------------------------------------------------

type DoctorRow = {
  id: string;
  clinicId: string;
  isActive: boolean;
  nameRu: string;
  nameUz: string;
  color: string | null;
  pricePerVisit: number | null;
  cabinetId: string | null;
  cabinet: { number: string } | null;
};

type PatientRow = {
  id: string;
  clinicId: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  patientNumber: number;
  preferredLang: string;
  source: string;
};

type AppointmentRow = {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  cabinetId: string | null;
  date: Date;
  time: string;
  durationMin: number;
  endDate: Date;
  status: string;
  queueStatus: string;
  queueOrder: number;
  ticketSeq: number;
  channel: string;
  ticketCode: string;
  createdById: string | null;
  priceBase: number | null;
  priceFinal: number | null;
};

type PublishCall = {
  clinicId: string;
  event: { type: string; payload: Record<string, unknown> };
};

const state = {
  doctors: new Map<string, DoctorRow>(),
  patients: [] as PatientRow[],
  appointments: [] as AppointmentRow[],
  publishes: [] as PublishCall[],
  patientNumberSeq: 1000,
  patientSeq: 0,
  apptSeq: 0,
  ticketCodeCalls: 0,
  txAttempts: 0,
  // How many of the first $transaction invocations should reject with a
  // simulated Postgres write-conflict (drives the runQueueTx retry test).
  failTxTimes: 0,
};

const TICKET_CODE = "TIK999";

// ----- module mocks ---------------------------------------------------------

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn(
    (
      clinicId: string,
      event: { type: string; payload: Record<string, unknown> },
    ) => {
      state.publishes.push({ clinicId, event });
    },
  ),
}));

vi.mock("@/server/services/patient-number", () => ({
  allocatePatientNumber: vi.fn(async () => {
    state.patientNumberSeq += 1;
    return state.patientNumberSeq;
  }),
}));

vi.mock("@/server/appointments/ticket-code", () => ({
  generateTicketCode: vi.fn(async () => {
    state.ticketCodeCalls += 1;
    return TICKET_CODE;
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { id: string; clinicId: string; isActive?: boolean };
        }) => {
          const d = state.doctors.get(where.id);
          if (!d) return null;
          if (d.clinicId !== where.clinicId) return null;
          if (where.isActive !== undefined && d.isActive !== where.isActive) {
            return null;
          }
          return {
            id: d.id,
            nameRu: d.nameRu,
            nameUz: d.nameUz,
            color: d.color,
            pricePerVisit: d.pricePerVisit,
            cabinetId: d.cabinetId,
            cabinet: d.cabinet ? { number: d.cabinet.number } : null,
          };
        },
      ),
    },
    patient: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            id?: string;
            clinicId: string;
            phone?: { in: string[] };
          };
        }) => {
          const hit = state.patients.find((p) => {
            if (p.clinicId !== where.clinicId) return false;
            if (where.id !== undefined) return p.id === where.id;
            if (where.phone) return where.phone.in.includes(p.phone);
            return false;
          });
          return hit ? { id: hit.id, fullName: hit.fullName } : null;
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<PatientRow, "id">;
        }) => {
          state.patientSeq += 1;
          const row: PatientRow = { id: `pat_${state.patientSeq}`, ...data };
          state.patients.push(row);
          return { id: row.id, fullName: row.fullName };
        },
      ),
    },
    appointment: {
      findUnique: vi.fn(async () => null),
      aggregate: vi.fn(
        async ({
          where,
        }: {
          where: {
            clinicId: string;
            doctorId: string;
            date: { gte: Date; lt: Date };
            queueStatus: { in: string[] };
          };
        }) => {
          let max: number | null = null;
          for (const a of state.appointments) {
            if (a.clinicId !== where.clinicId) continue;
            if (a.doctorId !== where.doctorId) continue;
            const t = a.date.getTime();
            if (t < where.date.gte.getTime() || t >= where.date.lt.getTime()) {
              continue;
            }
            if (!where.queueStatus.in.includes(a.queueStatus)) continue;
            if (max === null || a.queueOrder > max) max = a.queueOrder;
          }
          return { _max: { queueOrder: max } };
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<AppointmentRow, "id">;
        }) => {
          state.apptSeq += 1;
          const row: AppointmentRow = { id: `apt_${state.apptSeq}`, ...data };
          state.appointments.push(row);
          return { id: row.id };
        },
      ),
    },
    $transaction: vi.fn(
      async <T,>(
        fn: (tx: unknown) => Promise<T>,
        _opts?: unknown,
      ): Promise<T> => {
        state.txAttempts += 1;
        if (state.txAttempts <= state.failTxTimes) {
          const e = new Error("could not serialize access") as Error & {
            code?: string;
          };
          e.code = "P2034";
          throw e;
        }
        const { prisma } = await import("@/lib/prisma");
        return fn(prisma);
      },
    ),
  },
}));

// ----- helpers --------------------------------------------------------------

async function loadRegisterWalkin() {
  const mod = await import("@/server/appointments/walkin");
  return mod.registerWalkin;
}

function seedDoctor(overrides: Partial<DoctorRow> = {}): DoctorRow {
  const d: DoctorRow = {
    id: "doc_alpha",
    clinicId: "c1",
    isActive: true,
    nameRu: "Иванов",
    nameUz: "Ivanov",
    color: "#FF8800",
    pricePerVisit: 150000,
    cabinetId: "cab_1",
    cabinet: { number: "12" },
    ...overrides,
  };
  state.doctors.set(d.id, d);
  return d;
}

function seedPatient(overrides: Partial<PatientRow> = {}): PatientRow {
  state.patientSeq += 1;
  const p: PatientRow = {
    id: `pat_seed_${state.patientSeq}`,
    clinicId: "c1",
    fullName: "Пётр Петров",
    phone: "+998901112233",
    phoneNormalized: "+998901112233",
    patientNumber: 1,
    preferredLang: "RU",
    source: "WALKIN",
    ...overrides,
  };
  state.patients.push(p);
  return p;
}

function lastAppointmentData(): AppointmentRow {
  const row = state.appointments[state.appointments.length - 1];
  if (!row) throw new Error("no appointment created");
  return row;
}

beforeEach(() => {
  state.doctors = new Map();
  state.patients = [];
  state.appointments = [];
  state.publishes = [];
  state.patientNumberSeq = 1000;
  state.patientSeq = 0;
  state.apptSeq = 0;
  state.ticketCodeCalls = 0;
  state.txAttempts = 0;
  state.failTxTimes = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_UTC));
});

afterEach(() => {
  vi.useRealTimers();
});

// ----- tests ----------------------------------------------------------------

describe("registerWalkin — existing patient happy path (W1)", () => {
  it("places the patient WAITING, allocates order 1, returns the ticket payload", async () => {
    seedDoctor();
    const patient = seedPatient({ id: "pat_existing", fullName: "Анна Сидорова" });
    const registerWalkin = await loadRegisterWalkin();

    const result = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: patient.id },
      createdById: "user_recep",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.appointmentId).toBe("apt_1");
    expect(result.queueOrder).toBe(1);
    expect(result.ticketCode).toBe(TICKET_CODE);
    expect(result.ticketNumber).toBe("D-001"); // doc_alpha → prefix "D"
    expect(result.ticketNumber).toBe(ticketNumberFor("doc_alpha", 1));
    expect(result.patient).toEqual({ id: "pat_existing", fullName: "Анна Сидорова" });
    expect(result.doctor).toEqual({
      id: "doc_alpha",
      nameRu: "Иванов",
      nameUz: "Ivanov",
      color: "#FF8800",
    });
    expect(result.cabinet).toBe("12");
  });

  it("persists the appointment row with the WAITING / ticketSeq / price columns set", async () => {
    seedDoctor({ pricePerVisit: 150000 });
    const patient = seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: patient.id },
      createdById: "user_recep",
    });

    const row = lastAppointmentData();
    expect(row.clinicId).toBe("c1");
    expect(row.patientId).toBe("pat_existing");
    expect(row.doctorId).toBe("doc_alpha");
    expect(row.cabinetId).toBe("cab_1");
    expect(row.status).toBe("WAITING");
    expect(row.queueStatus).toBe("WAITING");
    expect(row.queueOrder).toBe(1);
    // ticketSeq is the immutable frozen sequence — must equal the allocated order.
    expect(row.ticketSeq).toBe(1);
    expect(row.channel).toBe("WALKIN");
    expect(row.ticketCode).toBe(TICKET_CODE);
    expect(row.createdById).toBe("user_recep");
    expect(row.priceBase).toBe(150000);
    expect(row.priceFinal).toBe(150000);
  });

  it("does NOT find-or-create: existing patient skips allocatePatientNumber + patient.create", async () => {
    seedDoctor();
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
    });

    const { prisma } = await import("@/lib/prisma");
    const { allocatePatientNumber } = await import(
      "@/server/services/patient-number"
    );
    expect(prisma.patient.create).not.toHaveBeenCalled();
    expect(allocatePatientNumber).not.toHaveBeenCalled();
  });
});

describe("registerWalkin — Tashkent wall-clock display column (W2)", () => {
  it("writes the Tashkent time (13:30), NOT the UTC hour (08:30) — guards the −5h skew", async () => {
    seedDoctor();
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
    });

    const row = lastAppointmentData();
    expect(row.time).toBe(TASHKENT_TIME);
    expect(row.time).toBe(tashkentComponents(new Date(FROZEN_UTC)).time);
    expect(row.time).not.toBe("08:30");
  });

  it("defaults duration to 30 min and derives endDate = start + duration", async () => {
    seedDoctor();
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
    });

    const row = lastAppointmentData();
    expect(row.durationMin).toBe(30);
    expect(row.date.getTime()).toBe(new Date(FROZEN_UTC).getTime());
    expect(row.endDate.getTime() - row.date.getTime()).toBe(30 * 60_000);
  });

  it("honours an explicit durationMin override", async () => {
    seedDoctor();
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
      durationMin: 45,
    });

    const row = lastAppointmentData();
    expect(row.durationMin).toBe(45);
    expect(row.endDate.getTime() - row.date.getTime()).toBe(45 * 60_000);
  });
});

describe("registerWalkin — queueOrder allocation (real allocateQueueOrder) (W3)", () => {
  it("stacks sequential walk-ins for the same doctor: 1 → 2 → 3 with matching ticketSeq", async () => {
    seedDoctor();
    seedPatient({ id: "p1" });
    seedPatient({ id: "p2" });
    seedPatient({ id: "p3" });
    const registerWalkin = await loadRegisterWalkin();

    const r1 = await registerWalkin({ clinicId: "c1", doctorId: "doc_alpha", patient: { id: "p1" } });
    const r2 = await registerWalkin({ clinicId: "c1", doctorId: "doc_alpha", patient: { id: "p2" } });
    const r3 = await registerWalkin({ clinicId: "c1", doctorId: "doc_alpha", patient: { id: "p3" } });

    expect([r1, r2, r3].every((r) => r.ok)).toBe(true);
    if (!r1.ok || !r2.ok || !r3.ok) return;
    expect([r1.queueOrder, r2.queueOrder, r3.queueOrder]).toEqual([1, 2, 3]);
    expect([r1.ticketNumber, r2.ticketNumber, r3.ticketNumber]).toEqual([
      "D-001",
      "D-002",
      "D-003",
    ]);
    expect(state.appointments.map((a) => a.ticketSeq)).toEqual([1, 2, 3]);
  });

  it("a different doctor gets an independent counter starting at 1", async () => {
    seedDoctor({ id: "doc_alpha" });
    seedDoctor({ id: "beta_doc", cabinet: { number: "7" } });
    seedPatient({ id: "p1" });
    seedPatient({ id: "p2" });
    const registerWalkin = await loadRegisterWalkin();

    await registerWalkin({ clinicId: "c1", doctorId: "doc_alpha", patient: { id: "p1" } });
    const r2 = await registerWalkin({ clinicId: "c1", doctorId: "beta_doc", patient: { id: "p2" } });

    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.queueOrder).toBe(1);
    expect(r2.ticketNumber).toBe("B-001"); // beta_doc → prefix "B"
    expect(r2.cabinet).toBe("7");
  });
});

describe("registerWalkin — find-or-create patient by phone (W4)", () => {
  it("reuses an existing patient matched via a phone variant (no create)", async () => {
    seedDoctor();
    seedPatient({ id: "pat_known", phone: "+998901234567", fullName: "Известный" });
    const registerWalkin = await loadRegisterWalkin();

    // Caller typed the bare 9-digit local form; phoneSearchVariants must still match.
    const result = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { fullName: "Ignored Name", phone: "901234567" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patient).toEqual({ id: "pat_known", fullName: "Известный" });

    const { prisma } = await import("@/lib/prisma");
    expect(prisma.patient.create).not.toHaveBeenCalled();
  });

  it("creates a new patient when no phone match: WALKIN source, normalized phone, lang", async () => {
    seedDoctor();
    const registerWalkin = await loadRegisterWalkin();

    const result = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { fullName: "Новый Пациент", phone: "901234567", lang: "UZ" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { prisma } = await import("@/lib/prisma");
    const { allocatePatientNumber } = await import(
      "@/server/services/patient-number"
    );
    expect(allocatePatientNumber).toHaveBeenCalledTimes(1);
    expect(prisma.patient.create).toHaveBeenCalledTimes(1);

    const created = state.patients.find((p) => p.fullName === "Новый Пациент");
    expect(created).toBeDefined();
    expect(created!.source).toBe("WALKIN");
    expect(created!.phone).toBe("+998901234567"); // normalized
    expect(created!.phoneNormalized).toBe("+998901234567");
    expect(created!.preferredLang).toBe("UZ");
    expect(result.patient.id).toBe(created!.id);
  });

  it("defaults preferredLang to RU when lang omitted", async () => {
    seedDoctor();
    const registerWalkin = await loadRegisterWalkin();

    await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { fullName: "Без Языка", phone: "901234567" },
    });

    const created = state.patients.find((p) => p.fullName === "Без Языка");
    expect(created!.preferredLang).toBe("RU");
  });
});

describe("registerWalkin — realtime envelopes (W5)", () => {
  it("emits appointment.created + queue.updated with the correct payloads", async () => {
    seedDoctor();
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    const result = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(state.publishes).toHaveLength(2);
    const [createdEv, queueEv] = state.publishes;

    expect(createdEv!.clinicId).toBe("c1");
    expect(createdEv!.event.type).toBe("appointment.created");
    expect(createdEv!.event.payload).toEqual({
      appointmentId: result.appointmentId,
      doctorId: "doc_alpha",
      patientId: "pat_existing",
      status: "WAITING",
    });

    expect(queueEv!.clinicId).toBe("c1");
    expect(queueEv!.event.type).toBe("queue.updated");
    expect(queueEv!.event.payload).toEqual({
      appointmentId: result.appointmentId,
      doctorId: "doc_alpha",
      queueStatus: "WAITING",
    });
  });
});

describe("registerWalkin — channel + createdById passthrough (W6)", () => {
  it("kiosk-style call: createdById null, default WALKIN channel", async () => {
    seedDoctor();
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
    });

    const row = lastAppointmentData();
    expect(row.createdById).toBeNull();
    expect(row.channel).toBe("WALKIN");
  });

  it("honours an explicit channel override", async () => {
    seedDoctor();
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
      channel: "KIOSK",
    });

    expect(lastAppointmentData().channel).toBe("KIOSK");
  });

  it("doctor with null pricePerVisit leaves priceBase/priceFinal null", async () => {
    seedDoctor({ pricePerVisit: null });
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
    });

    const row = lastAppointmentData();
    expect(row.priceBase).toBeNull();
    expect(row.priceFinal).toBeNull();
  });
});

describe("registerWalkin — failure paths short-circuit with zero side effects (W7)", () => {
  it("unknown doctor → doctor_not_found, no patient lookup / ticket / tx / publish", async () => {
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    const result = await registerWalkin({
      clinicId: "c1",
      doctorId: "ghost",
      patient: { id: "pat_existing" },
    });

    expect(result).toEqual({ ok: false, reason: "doctor_not_found" });

    const { prisma } = await import("@/lib/prisma");
    const { generateTicketCode } = await import(
      "@/server/appointments/ticket-code"
    );
    expect(prisma.patient.findFirst).not.toHaveBeenCalled();
    expect(generateTicketCode).not.toHaveBeenCalled();
    expect(prisma.appointment.create).not.toHaveBeenCalled();
    expect(state.publishes).toHaveLength(0);
  });

  it("inactive doctor is treated as not found", async () => {
    seedDoctor({ isActive: false });
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    const result = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
    });
    expect(result).toEqual({ ok: false, reason: "doctor_not_found" });
  });

  it("doctor from another clinic is not found (tenant scope)", async () => {
    seedDoctor({ clinicId: "other_clinic" });
    const registerWalkin = await loadRegisterWalkin();

    const result = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
    });
    expect(result).toEqual({ ok: false, reason: "doctor_not_found" });
  });

  it("explicit patient id not found → patient_not_found, no ticket / tx", async () => {
    seedDoctor();
    const registerWalkin = await loadRegisterWalkin();

    const result = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "missing_patient" },
    });

    expect(result).toEqual({ ok: false, reason: "patient_not_found" });
    const { generateTicketCode } = await import(
      "@/server/appointments/ticket-code"
    );
    expect(generateTicketCode).not.toHaveBeenCalled();
    expect(state.appointments).toHaveLength(0);
  });

  it("unnormalizable phone for a new patient → bad_phone, before any patient lookup", async () => {
    seedDoctor();
    const registerWalkin = await loadRegisterWalkin();

    const result = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { fullName: "No Digits", phone: "---" },
    });

    expect(result).toEqual({ ok: false, reason: "bad_phone" });
    const { prisma } = await import("@/lib/prisma");
    expect(prisma.patient.findFirst).not.toHaveBeenCalled();
    expect(prisma.patient.create).not.toHaveBeenCalled();
    expect(state.appointments).toHaveLength(0);
  });
});

describe("registerWalkin — Serializable retry via runQueueTx (W8)", () => {
  it("retries on a write-conflict and still allocates a single correct slot", async () => {
    seedDoctor();
    seedPatient({ id: "pat_existing" });
    state.failTxTimes = 1; // first queue tx attempt rejects with P2034
    const registerWalkin = await loadRegisterWalkin();

    const result = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_alpha",
      patient: { id: "pat_existing" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.queueOrder).toBe(1);

    const { prisma } = await import("@/lib/prisma");
    // Two $transaction calls (one failed, one succeeded), exactly one row.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(state.appointments).toHaveLength(1);
    expect(state.appointments[0]!.queueOrder).toBe(1);
  });

  it("a non-write-conflict error is not retried and propagates", async () => {
    seedDoctor();
    seedPatient({ id: "pat_existing" });
    const registerWalkin = await loadRegisterWalkin();

    // Make the queue tx throw a generic (non-conflict) error once.
    const { prisma } = await import("@/lib/prisma");
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("boom"),
    );

    await expect(
      registerWalkin({
        clinicId: "c1",
        doctorId: "doc_alpha",
        patient: { id: "pat_existing" },
      }),
    ).rejects.toThrow("boom");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // no retry
    expect(state.appointments).toHaveLength(0);
  });
});
