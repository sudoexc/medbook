/**
 * Who may move where (audits AP-06, AP-09, AP-10), through the real PATCH
 * /api/crm/appointments/[id], the real bulk reschedule and the real
 * `detectConflicts`, over an in-memory appointment.
 *
 *   AP-06 — a live-queue ticket (WALKIN) keeps its channel and its slot.
 *     A flip to «Телефон» dropped the patient out of the doctor's queue and
 *     the TV, or met a booking under the EXCLUDE constraint and the desk
 *     got a 500. A write the constraint refuses is now a 409 doctor_busy.
 *   AP-09 — nothing is booked or moved into the past. Reschedules skipped
 *     the rule (they pass `excludeId`): a wrong month in the drawer or a bulk
 *     shift backwards landed the visit in the past and the sweep marked a
 *     no-show at once. A move that keeps the start (a doctor swap on a visit
 *     under way) still goes through.
 *   AP-10 — only a visit that can still be rescheduled moves; a completed,
 *     cancelled, missed or running visit answers 409 and nobody is told
 *     «приём перенесён».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  channel: string;
  cancelledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelReason: string | null;
  medicalCaseId: string | null;
  priceBase: number | null;
  priceFinal: number | null;
  discountPct: number;
  discountAmount: number;
  queuePriority: number;
  doctor: { userId: string };
};

// «Now» is Mon 28.09.2026 11:00 in Tashkent.
const NOW = new Date("2026-09-28T06:00:00.000Z");
// Tomorrow 10:00 Tashkent.
const TOMORROW_10 = new Date("2026-09-29T05:00:00.000Z");

const state = {
  apt: null as Appointment | null,
  updates: [] as Array<Record<string, unknown>>,
  failUpdateWith: null as unknown,
};

const h = vi.hoisted(() => ({
  fireTrigger: vi.fn(),
}));

function makeAppointment(over: Partial<Appointment> = {}): Appointment {
  const start = over.date ?? TOMORROW_10;
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    cabinetId: "cab_1",
    date: start,
    endDate: new Date(start.getTime() + 30 * 60_000),
    durationMin: 30,
    time: "10:00",
    status: "BOOKED",
    queueStatus: "BOOKED",
    channel: "PHONE",
    cancelledAt: null,
    startedAt: null,
    completedAt: null,
    cancelReason: null,
    medicalCaseId: null,
    priceBase: 100_000,
    priceFinal: 100_000,
    discountPct: 0,
    discountAmount: 0,
    queuePriority: 0,
    doctor: { userId: "u_doc_1" },
    ...over,
  };
}

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_admin", role: "ADMIN", clinicId: "c1", email: "a@x.t" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
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
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: h.fireTrigger,
}));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_1",
  publishViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    appointment: {
      findUnique: vi.fn(
        async ({ where, select }: { where: { id: string }; select?: { payments?: unknown } }) => {
          if (!state.apt || state.apt.id !== where.id) return null;
          // A doctor change reads the visit's lines and payments (review of
          // DR-02): none here, so the visit keeps its price and length.
          if (select?.payments) {
            return { serviceId: null, services: [], payments: [] };
          }
          return state.apt;
        },
      ),
      findUniqueOrThrow: vi.fn(async () => state.apt),
      findMany: vi.fn(async () => (state.apt ? [state.apt] : [])),
      // No other booking on the doctor's grid.
      findFirst: vi.fn(async () => null),
      update: vi.fn(
        async ({ data }: { where: { id: string }; data: Record<string, unknown> }) => {
          if (state.failUpdateWith) throw state.failUpdateWith;
          state.updates.push(data);
          state.apt = { ...state.apt!, ...(data as Partial<Appointment>) };
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
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        cabinetId: where.id === "doc_2" ? "cab_2" : "cab_1",
        isActive: true,
      })),
    },
    // No schedule rows: the doctor is unconstrained; no time off.
    doctorSchedule: { findMany: vi.fn(async () => []) },
    doctorTimeOff: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn(async () => ({ id: "al" })) },
    eventOutbox: { create: vi.fn(async () => ({ id: "ob" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  };
  return { prisma };
});

async function patch(body: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/crm/appointments/[id]/route");
  return PATCH(
    new Request("https://x/api/crm/appointments/apt_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function reasonOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { reason?: string }).reason;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.apt = makeAppointment();
  state.updates = [];
  state.failUpdateWith = null;
  h.fireTrigger.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AP-06 — a live-queue ticket keeps its channel and slot", () => {
  const walkin = () =>
    makeAppointment({
      channel: "WALKIN",
      status: "WAITING",
      queueStatus: "WAITING",
      date: new Date("2026-09-28T05:30:00.000Z"),
      time: "10:30",
    });

  it("PATCH {channel: PHONE} on a WALKIN answers 409 walkin_locked and writes nothing", async () => {
    state.apt = walkin();
    const res = await patch({ channel: "PHONE" });
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toBe("walkin_locked");
    expect(state.updates).toEqual([]);
    expect(state.apt!.channel).toBe("WALKIN");
  });

  it("a walk-in's time or day is not moved (it would drop out of today's queue)", async () => {
    state.apt = walkin();
    const moved = await patch({ time: "15:00" });
    expect(moved.status).toBe(409);
    expect(await reasonOf(moved)).toBe("walkin_locked");

    const nextDay = await patch({ date: "2026-09-29", time: "10:00" });
    expect(nextDay.status).toBe(409);
    expect(state.updates).toEqual([]);
  });

  it("the walk-in's notes still save", async () => {
    state.apt = walkin();
    const res = await patch({ comments: "Пришла с дочерью" });
    expect(res.status).toBe(200);
  });

  it("a slot lost to a concurrent booking (23P01) is a 409 doctor_busy, not a 500", async () => {
    state.failUpdateWith = Object.assign(
      new Error(
        'conflicting key value violates exclusion constraint "Appointment_doctor_no_overlap"',
      ),
      { name: "DriverAdapterError", cause: { originalCode: "23P01" } },
    );
    const res = await patch({ time: "12:00" });
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toBe("doctor_busy");
  });

  it("bulk reschedule refuses a batch holding a walk-in and names it", async () => {
    state.apt = walkin();
    const { POST } = await import("@/app/api/crm/appointments/bulk-reschedule/route");
    const res = await POST(
      new Request("https://x/api/crm/appointments/bulk-reschedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ["apt_1"], deltaMinutes: 30 }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string; id: string };
    expect(body.reason).toBe("walkin_locked");
    expect(body.id).toBe("apt_1");
    expect(state.updates).toEqual([]);
  });
});

describe("AP-09 — no booking or reschedule into the past", () => {
  it("PATCH {date: yesterday} answers 409 in_past", async () => {
    const res = await patch({ date: "2026-09-27", time: "10:00" });
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toBe("in_past");
    expect(state.updates).toEqual([]);
    expect(h.fireTrigger).not.toHaveBeenCalled();
  });

  it("today, earlier than now, is the past too", async () => {
    const res = await patch({ date: "2026-09-28", time: "09:00" });
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toBe("in_past");
  });

  it("a move that keeps a started visit's start (a doctor swap) still goes through", async () => {
    state.apt = makeAppointment({
      date: new Date("2026-09-28T05:30:00.000Z"), // 10:30 today, begun
      time: "10:30",
      status: "WAITING",
      queueStatus: "WAITING",
    });
    const res = await patch({ doctorId: "doc_2" });
    expect(res.status).toBe(200);
    expect(state.apt!.doctorId).toBe("doc_2");
  });

  it("a move to a future slot is fine", async () => {
    const res = await patch({ date: "2026-09-30", time: "11:00" });
    expect(res.status).toBe(200);
    expect(h.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.rescheduled",
      appointmentId: "apt_1",
    });
  });

  it("bulk reschedule with a negative shift into the past answers 409 in_past", async () => {
    // Today 12:00; shifted back two hours to 10:00, already behind «now».
    state.apt = makeAppointment({
      date: new Date("2026-09-28T07:00:00.000Z"),
      time: "12:00",
    });
    const { POST } = await import("@/app/api/crm/appointments/bulk-reschedule/route");
    const res = await POST(
      new Request("https://x/api/crm/appointments/bulk-reschedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ["apt_1"], deltaMinutes: -120 }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toBe("in_past");
    expect(state.updates).toEqual([]);
  });

  it("detectConflicts: a move needs a future start unless it keeps the current one", async () => {
    const { detectConflicts } = await import("@/server/services/appointments");
    const past = new Date("2026-09-28T05:00:00.000Z");
    const end = new Date(past.getTime() + 30 * 60_000);
    // A new booking in the past.
    expect(
      await detectConflicts({ doctorId: "doc_1", startAt: past, endAt: end }),
    ).toEqual({ ok: false, reason: "in_past" });
    // A reschedule to the past.
    expect(
      await detectConflicts({
        doctorId: "doc_1",
        startAt: past,
        endAt: end,
        excludeId: "apt_1",
        currentStartAt: TOMORROW_10,
      }),
    ).toEqual({ ok: false, reason: "in_past" });
    // A reschedule with no known start is treated as a move.
    expect(
      (await detectConflicts({ doctorId: "doc_1", startAt: past, endAt: end, excludeId: "apt_1" }))
        .ok,
    ).toBe(false);
    // Same start kept.
    expect(
      await detectConflicts({
        doctorId: "doc_1",
        startAt: past,
        endAt: end,
        excludeId: "apt_1",
        currentStartAt: past,
      }),
    ).toEqual({ ok: true });
  });

  it("a past day has no free slots at all", async () => {
    const { findAvailableSlots } = await import("@/server/services/appointments");
    expect(
      await findAvailableSlots({
        doctorId: "doc_1",
        date: new Date("2026-08-23T00:00:00.000Z"),
      }),
    ).toEqual([]);
    // Tomorrow still offers the fallback grid.
    const tomorrow = await findAvailableSlots({
      doctorId: "doc_1",
      date: new Date("2026-09-29T00:00:00.000Z"),
    });
    expect(tomorrow.length).toBeGreaterThan(0);
  });
});

describe("AP-10 — only a reschedulable visit moves", () => {
  for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW", "IN_PROGRESS"]) {
    it(`PATCH {time} on a ${status} visit answers 409 and tells nobody`, async () => {
      state.apt = makeAppointment({ status, queueStatus: status });
      const res = await patch({ time: "15:00" });
      expect(res.status).toBe(409);
      expect(await reasonOf(res)).toBe("invalid_transition");
      expect(state.updates).toEqual([]);
      expect(h.fireTrigger).not.toHaveBeenCalled();
    });
  }

  it("a completed visit is not handed to another doctor either", async () => {
    state.apt = makeAppointment({ status: "COMPLETED", queueStatus: "COMPLETED" });
    const res = await patch({ doctorId: "doc_2" });
    expect(res.status).toBe(409);
    expect(state.apt!.doctorId).toBe("doc_1");
  });

  it("the same PATCH on a BOOKED, CONFIRMED, WAITING or SKIPPED visit moves it", async () => {
    for (const status of ["BOOKED", "CONFIRMED", "WAITING", "SKIPPED"]) {
      state.apt = makeAppointment({ status, queueStatus: status });
      const res = await patch({ time: "15:00" });
      expect(res.status, status).toBe(200);
    }
  });

  it("the calendar lets exactly those blocks be dragged or resized", async () => {
    const { isCalendarMovable } = await import("@/lib/calendar/reschedule-math");
    for (const status of ["BOOKED", "CONFIRMED", "WAITING", "SKIPPED"]) {
      expect(isCalendarMovable({ status, channel: "PHONE" }), status).toBe(true);
    }
    for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW", "IN_PROGRESS"]) {
      expect(isCalendarMovable({ status, channel: "PHONE" }), status).toBe(false);
    }
    // A live-queue ticket is never a draggable slot (AP-06).
    expect(isCalendarMovable({ status: "WAITING", channel: "WALKIN" })).toBe(false);
  });

  it("a resize keeps the «not in the past» rule of a drag", async () => {
    const { computeResizedSlot } = await import("@/lib/calendar/reschedule-math");
    expect(
      computeResizedSlot({
        start: TOMORROW_10,
        newEnd: new Date(TOMORROW_10.getTime() + 45 * 60_000),
        now: NOW,
      }),
    ).toEqual({ ok: true, durationMin: 45 });
    const begun = new Date("2026-09-28T05:30:00.000Z");
    expect(
      computeResizedSlot({
        start: begun,
        newEnd: new Date(begun.getTime() + 60 * 60_000),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "in_past" });
  });
});

describe("isSlotOverlapViolation", () => {
  it("recognises the EXCLUDE refusal in every shape the adapter surfaces", async () => {
    const { isSlotOverlapViolation } = await import(
      "@/server/appointments/overlap-violation"
    );
    expect(isSlotOverlapViolation({ code: "23P01" })).toBe(true);
    expect(isSlotOverlapViolation({ originalCode: "23P01" })).toBe(true);
    expect(isSlotOverlapViolation({ cause: { originalCode: "23P01" } })).toBe(true);
    expect(
      isSlotOverlapViolation(new Error('violates "Appointment_cabinet_no_overlap"')),
    ).toBe(true);
    expect(isSlotOverlapViolation(new Error("connection reset"))).toBe(false);
    expect(isSlotOverlapViolation({ code: "40001" })).toBe(false);
    expect(isSlotOverlapViolation(null)).toBe(false);
  });
});
