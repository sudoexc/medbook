/**
 * Audits MA-16 and MA-17 — the patient moves his own booking.
 *
 * MA-16: a move wrote `priceFinal = priceBase` and wiped discounts and the
 * free repeat visit, and repriced a paid visit. Now a case-less move keeps
 * every price column, a visit in a case is repriced by the free-repeat
 * engine (which keeps a free repeat free inside its window and never touches
 * a paid visit), and new services are refused once money moved.
 *
 * MA-17: the server moved WALKIN, WAITING and NO_SHOW rows, kept the old
 * cabinet on a doctor change, and accepted any instant. Now only BOOKED /
 * CONFIRMED bookings move, re-checked in the write; a new doctor brings his
 * cabinet and must offer the services; the start must be on the grid,
 * within the horizon and not in the past; reminders are retracted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Line = { serviceId: string; priceSnap: number; quantity: number; freeRepeatDays: number | null };
type Row = Record<string, unknown> & {
  id: string;
  date: Date;
  lines: Line[];
  payments: Array<{ status: string }>;
};

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Row>,
  linked: true,
  onGrid: true,
  statusAtWrite: null as string | null,
  updateMany: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  conflictsArgs: [] as Array<Record<string, unknown>>,
  fired: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/server/services/appointments", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/services/appointments")>();
  return {
    ...real,
    // Same in-past rule as the real check (AP-09), no database.
    detectConflicts: vi.fn(async (args: Record<string, unknown>) => {
      state.conflictsArgs.push(args);
      const startAt = args.startAt as Date;
      const keeps =
        (args.currentStartAt as Date | undefined)?.getTime() === startAt.getTime();
      if (!keeps && startAt.getTime() <= Date.now()) return { ok: false, reason: "in_past" };
      return { ok: true };
    }),
    isOfferedSlotStart: vi.fn(async () => state.onGrid),
  };
});
vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: vi.fn((p: Record<string, unknown>) => state.fired.push(p)),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async (_tx: unknown, env: Record<string, unknown>) => {
    state.events.push(env);
    return { eventId: `ev${state.events.length}` };
  }),
}));

vi.mock("@/lib/prisma", () => {
  function view(r: Row) {
    return { ...r };
  }
  const appointment = {
    // The kernel's own read: services + payments other than UNPAID.
    findFirst: vi.fn(async ({ where }: { where: { id: string; patientId: string } }) => {
      const r = state.rows[where.id];
      if (!r || r.patientId !== where.patientId) return null;
      return {
        ...view(r),
        services: r.lines.map((l) => ({ serviceId: l.serviceId })),
        payments: r.payments.filter((p) => p.status !== "UNPAID").map((_, i) => ({ id: `pay${i}` })),
      };
    }),
    // The free-repeat engine's read (recomputeAppointmentPrice), or the
    // kernel's re-read after a lost race.
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const r = state.rows[where.id];
      if (!r) return null;
      return {
        ...view(r),
        payments: r.payments.filter((p) => p.status === "PAID").map((_, i) => ({ id: `pay${i}` })),
        services: r.lines.map((l) => ({
          serviceId: l.serviceId,
          priceSnap: l.priceSnap,
          quantity: l.quantity,
          service: { id: l.serviceId, priceBase: l.priceSnap, freeRepeatDays: l.freeRepeatDays },
        })),
        primaryService: null,
      };
    }),
    findMany: vi.fn(
      async ({ where, select }: { where: { medicalCaseId: string }; select: Record<string, unknown> }) => {
        const inCase = Object.values(state.rows)
          .filter((r) => r.medicalCaseId === where.medicalCaseId)
          .sort((a, b) => a.date.getTime() - b.date.getTime());
        return select.date ? inCase.map((r) => ({ id: r.id, date: r.date })) : inCase.map((r) => ({ id: r.id }));
      },
    ),
    updateMany: vi.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updateMany.push({ where, data });
        const r = state.rows[where.id as string]!;
        const status = state.statusAtWrite ?? (r.status as string);
        const allowed = (where.status as { in: string[] }).in;
        if (!allowed.includes(status)) {
          r.status = status;
          return { count: 0 };
        }
        Object.assign(r, data);
        return { count: 1 };
      },
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      Object.assign(state.rows[where.id]!, data);
      return view(state.rows[where.id]!);
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => view(state.rows[where.id]!)),
  };
  const prisma = {
    appointment,
    doctor: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "d2" ? { id: "d2", cabinetId: "cab2", cabinet: { isActive: true } } : null,
      ),
    },
    serviceOnDoctor: {
      count: vi.fn(async ({ where }: { where: { serviceId: { in: string[] } } }) =>
        state.linked ? where.serviceId.in.length : 0,
      ),
    },
    service: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, durationMin: 30, priceBase: 300_000 })),
      ),
    },
    appointmentService: {
      deleteMany: vi.fn(async ({ where }: { where: { appointmentId: string } }) => {
        state.rows[where.appointmentId]!.lines = [];
      }),
      createMany: vi.fn(
        async ({ data }: { data: Array<{ appointmentId: string; serviceId: string; priceSnap: number }> }) => {
          for (const d of data) {
            state.rows[d.appointmentId]!.lines.push({
              serviceId: d.serviceId,
              priceSnap: d.priceSnap,
              quantity: 1,
              freeRepeatDays: null,
            });
          }
        },
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});

import { reschedulePatientAppointment } from "@/server/appointments/patient-reschedule";

const NOW = new Date("2026-10-01T03:00:00Z");

function booking(over: Partial<Row> = {}): Row {
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "d1",
    cabinetId: "cab1",
    serviceId: "s1",
    medicalCaseId: null,
    date: new Date("2026-10-03T05:00:00Z"),
    endDate: new Date("2026-10-03T05:30:00Z"),
    time: "10:00",
    durationMin: 30,
    status: "BOOKED",
    queueStatus: "BOOKED",
    channel: "TELEGRAM",
    arrivedAt: null,
    priceService: 300_000,
    priceBase: 300_000,
    discountPct: 0,
    discountAmount: 50_000,
    priceFinal: 250_000,
    lines: [{ serviceId: "s1", priceSnap: 300_000, quantity: 1, freeRepeatDays: null }],
    payments: [],
    ...over,
  } as Row;
}

function move(over: Partial<Parameters<typeof reschedulePatientAppointment>[0]> = {}) {
  return reschedulePatientAppointment({
    clinicId: "c1",
    appointmentId: "apt_1",
    patientId: "p1",
    actor: { role: "PATIENT", userId: null, patientId: "p1", onBehalfOfPatientId: null, label: "patient:p1" },
    startAt: new Date("2026-10-03T06:00:00Z"),
    now: NOW,
    ...over,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  state.rows = { apt_1: booking() };
  state.linked = true;
  state.onGrid = true;
  state.statusAtWrite = null;
  state.updateMany = [];
  state.conflictsArgs = [];
  state.fired = [];
  state.events = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MA-16 prices on a move", () => {
  it("a case-less move keeps the discount: no price column is written", async () => {
    const res = await move();
    expect(res.ok).toBe(true);
    const data = state.updateMany[0]!.data;
    for (const k of ["priceBase", "priceService", "priceFinal", "discountPct", "discountAmount"]) {
      expect(data, k).not.toHaveProperty(k);
    }
    expect(state.rows.apt_1!.priceFinal).toBe(250_000);
  });

  it("a free repeat visit stays free when moved inside its window", async () => {
    state.rows = {
      apt_first: booking({
        id: "apt_first",
        date: new Date("2026-09-28T05:00:00Z"),
        status: "COMPLETED",
        medicalCaseId: "case_1",
        discountAmount: 0,
        priceFinal: 300_000,
        lines: [{ serviceId: "s1", priceSnap: 300_000, quantity: 1, freeRepeatDays: 14 }],
        payments: [{ status: "PAID" }],
      }),
      apt_1: booking({
        medicalCaseId: "case_1",
        discountAmount: 0,
        priceBase: 0,
        priceFinal: 0,
        lines: [{ serviceId: "s1", priceSnap: 300_000, quantity: 1, freeRepeatDays: 14 }],
      }),
    };
    const res = await move({ startAt: new Date("2026-10-05T06:00:00Z") });
    expect(res.ok).toBe(true);
    expect(state.rows.apt_1!.priceFinal).toBe(0);
    // The paid first visit is never repriced by the cascade.
    expect(state.rows.apt_first!.priceFinal).toBe(300_000);
  });

  it("a paid visit in a case keeps its price on a move", async () => {
    state.rows = {
      apt_1: booking({
        medicalCaseId: "case_1",
        priceFinal: 180_000,
        payments: [{ status: "PAID" }],
      }),
    };
    const res = await move();
    expect(res.ok).toBe(true);
    expect(state.rows.apt_1!.priceFinal).toBe(180_000);
  });

  it("new services on a visit with money on it are refused", async () => {
    state.rows = { apt_1: booking({ payments: [{ status: "PAID" }] }) };
    const res = await move({ serviceIds: ["s2"] });
    expect(res).toMatchObject({ ok: false, status: 409, reason: "has_payment" });
    expect(state.updateMany).toHaveLength(0);
  });

  it("new services are priced like a booking: lines minus the visit's discount", async () => {
    const res = await move({ serviceIds: ["s2"] });
    expect(res.ok).toBe(true);
    expect(state.rows.apt_1!.priceFinal).toBe(250_000);
    expect(state.rows.apt_1!.serviceId).toBe("s2");
  });
});

describe("MA-17 what may move and where", () => {
  for (const [label, over, reason] of [
    ["a live-queue ticket", { channel: "WALKIN" }, "not_reschedulable"],
    ["a queued visit", { status: "WAITING", queueStatus: "WAITING" }, "not_reschedulable"],
    ["a no-show", { status: "NO_SHOW", queueStatus: "NO_SHOW" }, "not_editable"],
    ["a visit on the table", { status: "IN_PROGRESS", queueStatus: "IN_PROGRESS" }, "not_editable"],
  ] as const) {
    it(`${label} is refused with 409 and nothing is written`, async () => {
      state.rows = { apt_1: booking(over as Partial<Row>) };
      const res = await move();
      expect(res).toMatchObject({ ok: false, status: 409, reason });
      expect(state.updateMany).toHaveLength(0);
    });
  }

  it("a start in the past is refused with 409", async () => {
    const res = await move({ startAt: new Date("2026-10-01T02:00:00Z") });
    expect(res).toMatchObject({ ok: false, status: 409, reason: "in_past" });
  });

  it("a start off the grid or past the horizon is refused with 400", async () => {
    state.onGrid = false;
    expect(await move()).toMatchObject({ ok: false, status: 400, reason: "off_grid" });
    state.onGrid = true;
    expect(await move({ startAt: new Date("2026-10-20T05:00:00Z") })).toMatchObject({
      ok: false,
      status: 400,
      reason: "beyond_horizon",
    });
  });

  it("a new doctor brings his cabinet, and the overlap check uses it", async () => {
    const res = await move({ doctorId: "d2" });
    expect(res.ok).toBe(true);
    expect(state.conflictsArgs[0]).toMatchObject({ doctorId: "d2", cabinetId: "cab2" });
    expect(state.updateMany[0]!.data).toMatchObject({ doctorId: "d2", cabinetId: "cab2" });
  });

  it("a new doctor who does not offer the visit's service is 404", async () => {
    state.linked = false;
    const res = await move({ doctorId: "d2" });
    expect(res).toMatchObject({ ok: false, status: 404, reason: "service_not_found" });
  });

  it("reception marking «Пришёл» during the move wins", async () => {
    state.statusAtWrite = "WAITING";
    const res = await move();
    expect(res).toMatchObject({ ok: false, status: 409, reason: "not_reschedulable" });
    expect(state.fired).toHaveLength(0);
    // The write itself carried the movable-state check.
    expect(state.updateMany[0]!.where).toMatchObject({
      status: { in: ["BOOKED", "CONFIRMED"] },
      channel: { not: "WALKIN" },
      arrivedAt: null,
    });
  });

  it("a moved start retracts the old reminders (appointment.rescheduled)", async () => {
    await move();
    expect(state.fired).toEqual([{ kind: "appointment.rescheduled", appointmentId: "apt_1" }]);
    expect(state.rows.apt_1!.time).toBe("11:00");
  });

  it("only the acting patient's visit is found", async () => {
    const res = await move({ patientId: "p_other" });
    expect(res).toMatchObject({ ok: false, status: 404 });
  });
});
