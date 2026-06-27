/**
 * Phase 11 — APPOINTMENT_RESCHEDULED audit emit on PATCH /api/crm/appointments/[id].
 *
 * The PATCH handler is a fat one (status transitions, conflict detection,
 * pricing recompute, realtime fan-out, notification triggers). We don't try
 * to test all of that here — only that the dedicated reschedule-audit row
 * fires exactly when slot-defining fields (date/endDate/doctorId/cabinetId)
 * actually change, and that it stays silent for status-only or no-op PATCHes.
 *
 * Strategy: mock every collaborator the route imports and capture
 * `prisma.auditLog.create` calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- shared in-memory state ----------------------------------------------

type Appointment = {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  cabinetId: string | null;
  date: Date;
  endDate: Date;
  durationMin: number;
  time: string | null;
  status: string;
  queueStatus: string;
  cancelledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelReason: string | null;
  medicalCaseId: string | null;
  priceBase: number | null;
  priceFinal: number | null;
  discountPct: number;
  discountAmount: number;
  doctor: { userId: string };
};

const state = {
  apt: null as Appointment | null,
  audits: [] as Array<{ action: string; entityId: string | null; meta: unknown }>,
  publishes: [] as Array<{ type: string; payload: unknown }>,
};

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  const start = new Date("2026-06-01T10:00:00.000Z");
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    cabinetId: "cab_1",
    date: start,
    endDate: end,
    durationMin: 30,
    time: "10:00",
    status: "BOOKED",
    queueStatus: "BOOKED",
    cancelledAt: null,
    startedAt: null,
    completedAt: null,
    cancelReason: null,
    medicalCaseId: null,
    priceBase: 100_000,
    priceFinal: 100_000,
    discountPct: 0,
    discountAmount: 0,
    doctor: { userId: "u_doc_1" },
    ...overrides,
  };
}

// ----- module mocks --------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: "u_admin",
      role: "ADMIN",
      clinicId: "c1",
      email: "admin@example.test",
    },
  })),
}));

vi.mock("@/lib/pin", () => ({
  hasValidPin: () => false,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_admin",
    role: "ADMIN" as const,
  }),
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

// Service helpers — the simple deterministic implementations the route needs.
vi.mock("@/server/services/appointments", () => ({
  applyTime: (date: Date, time: string | null | undefined) => {
    if (!time) return date;
    const [h, m] = time.split(":").map((v) => Number.parseInt(v, 10));
    const out = new Date(date);
    out.setUTCHours(h ?? 0, m ?? 0, 0, 0);
    return out;
  },
  computeEndDate: (start: Date, durationMin: number) =>
    new Date(start.getTime() + durationMin * 60_000),
  detectConflicts: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: vi.fn(async () => undefined),
}));

vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: vi.fn(),
}));

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn((_clinicId: string, ev: { type: string; payload: unknown }) => {
    state.publishes.push(ev);
  }),
}));

vi.mock("@/lib/appointment-transitions", () => ({
  canTransitionAt: () => ({ ok: true }),
}));

// Prisma mock — only the surface PATCH actually touches.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (state.apt && state.apt.id === where.id) return state.apt;
        return null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (state.apt && state.apt.id === where.id) return state.apt;
        throw new Error("not found");
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          if (!state.apt || state.apt.id !== where.id) {
            throw new Error("not found");
          }
          state.apt = { ...state.apt, ...(data as Partial<Appointment>) };
          return state.apt;
        },
      ),
    },
    appointmentService: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    service: { findMany: vi.fn(async () => []) },
    doctor: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => {
          if (where.id === "doc_2") {
            return { cabinetId: "cab_2", isActive: true };
          }
          return { cabinetId: "cab_1", isActive: true };
        },
      ),
    },
    auditLog: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { action: string; entityId: string | null; meta: unknown };
        }) => {
          state.audits.push({
            action: data.action,
            entityId: data.entityId ?? null,
            meta: data.meta,
          });
          return { id: `a_${state.audits.length}` };
        },
      ),
    },
    // Phase B.3 — PATCH now writes envelope rows via the outbox helper
    // (publishViaOutbox) inside the same transaction. The test doesn't
    // assert envelope content; it just needs the call not to crash.
    eventOutbox: {
      create: vi.fn(async () => ({ id: "outbox_stub" })),
    },
    $transaction: vi.fn(
      async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        // Pass the same prisma object as the tx — sufficient for these tests
        // because the route only calls update / deleteMany / createMany /
        // findUniqueOrThrow on it.
        const { prisma } = await import("@/lib/prisma");
        return fn(prisma);
      },
    ),
  },
}));

// ----- helpers -------------------------------------------------------------

async function loadPatch() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/appointments/[id]/route");
  return mod.PATCH;
}

function patchReq(body: unknown): Request {
  return new Request("https://x/api/crm/appointments/apt_1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.apt = makeAppointment();
  state.audits = [];
  state.publishes = [];
});

// ----- tests ---------------------------------------------------------------

describe("PATCH /api/crm/appointments/[id] — APPOINTMENT_RESCHEDULED audit", () => {
  it("emits APPOINTMENT_RESCHEDULED when start time changes", async () => {
    const PATCH = await loadPatch();
    // Same date, new time → applyTime computes a new startAt → reschedule.
    const res = await PATCH(patchReq({ time: "11:30" }));
    expect(res.status).toBe(200);

    const reschedule = state.audits.find(
      (a) => a.action === "APPOINTMENT_RESCHEDULED",
    );
    expect(reschedule).toBeDefined();
    const meta = reschedule!.meta as {
      oldStartTime: Date | string;
      newStartTime: Date | string;
      oldDoctorId: string;
      newDoctorId: string;
      oldCabinetId: string | null;
      newCabinetId: string | null;
    };
    expect(new Date(meta.oldStartTime).toISOString()).toBe(
      "2026-06-01T10:00:00.000Z",
    );
    expect(new Date(meta.newStartTime).toISOString()).not.toBe(
      "2026-06-01T10:00:00.000Z",
    );
    expect(meta.oldDoctorId).toBe("doc_1");
    expect(meta.newDoctorId).toBe("doc_1");
    expect(meta.oldCabinetId).toBe("cab_1");
    expect(meta.newCabinetId).toBe("cab_1");
  });

  it("emits APPOINTMENT_RESCHEDULED when doctor (and derived cabinet) changes", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ doctorId: "doc_2" }));
    expect(res.status).toBe(200);

    const reschedule = state.audits.find(
      (a) => a.action === "APPOINTMENT_RESCHEDULED",
    );
    expect(reschedule).toBeDefined();
    const meta = reschedule!.meta as {
      oldDoctorId: string;
      newDoctorId: string;
      oldCabinetId: string | null;
      newCabinetId: string | null;
    };
    expect(meta.oldDoctorId).toBe("doc_1");
    expect(meta.newDoctorId).toBe("doc_2");
    expect(meta.oldCabinetId).toBe("cab_1");
    expect(meta.newCabinetId).toBe("cab_2");
  });

  it("does NOT emit APPOINTMENT_RESCHEDULED for status-only PATCHes", async () => {
    const PATCH = await loadPatch();
    // CONFIRMED is a role-agnostic status-only change (IN_PROGRESS/COMPLETED
    // are doctor-owned and 403 for the ADMIN ctx this suite mocks). No
    // slot-defining field changes, so no reschedule audit should fire.
    const res = await PATCH(patchReq({ status: "CONFIRMED" }));
    expect(res.status).toBe(200);

    const reschedule = state.audits.find(
      (a) => a.action === "APPOINTMENT_RESCHEDULED",
    );
    expect(reschedule).toBeUndefined();
    // The generic appointment.update audit still fires.
    expect(
      state.audits.some((a) => a.action === "appointment.update"),
    ).toBe(true);
  });

  it("does NOT emit APPOINTMENT_RESCHEDULED for no-op time PATCH (same start)", async () => {
    const PATCH = await loadPatch();
    // Send the same time the appointment already has — no real reschedule.
    const res = await PATCH(patchReq({ time: "10:00" }));
    expect(res.status).toBe(200);

    const reschedule = state.audits.find(
      (a) => a.action === "APPOINTMENT_RESCHEDULED",
    );
    expect(reschedule).toBeUndefined();
  });
});
