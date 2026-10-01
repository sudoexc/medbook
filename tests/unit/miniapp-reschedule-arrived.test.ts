import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Review of audit MA-20: live-queue visits now sit in «Предстоящие», and the
 * Mini App reschedule PATCH rewrote date/time of a WAITING walk-in while its
 * queue columns stayed WAITING. The ticket left today's reception queue and
 * TV board (both read today's rows only) and turned up tomorrow already
 * queued. An arrived visit (live queue, skipped, «Я на месте») is now refused
 * with not_reschedulable; cancelling it still works.
 */

const WALKIN_ROW = {
  id: "apt_w",
  clinicId: "c1",
  patientId: "p_tg",
  doctorId: "d1",
  cabinetId: "cab1",
  serviceId: "s1",
  date: new Date("2026-10-01T05:12:00Z"),
  time: "10:12",
  durationMin: 30,
  endDate: new Date("2026-10-01T05:42:00Z"),
  ticketCode: "WLK001",
  ticketSeq: 7,
  queueOrder: 7,
  queuedAt: new Date("2026-10-01T05:12:00Z"),
  // registerWalkin: arrived and queued from the first second.
  status: "WAITING",
  queueStatus: "WAITING",
  channel: "WALKIN",
  arrivedAt: null as Date | null,
  priceBase: 100,
  priceFinal: 100,
  medicalCaseId: null,
  services: [{ serviceId: "s1" }],
  payments: [],
};

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
}));

vi.mock("@/server/miniapp/handler", () => {
  const ctx = {
    clinicId: "c1",
    clinicSlug: "neurofax",
    patientId: "p_tg",
    patient: { id: "p_tg", fullName: "Dilnoza", preferredLang: "RU" },
  };
  return {
    createMiniAppHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) => {
        const body = opts?.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined;
        return handler({ request, body, ctx });
      },
  };
});

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  doctorFindFirst: vi.fn(),
  detectConflicts: vi.fn(),
  publishViaOutbox: vi.fn(),
  fireTrigger: vi.fn(),
  cancelAppointment: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const appointment = {
    findFirst: vi.fn(async () => (state.row ? { ...state.row } : null)),
    findUnique: vi.fn(async () => (state.row ? { ...state.row } : null)),
    findUniqueOrThrow: vi.fn(async () => ({ ...state.row })),
    update: mocks.update,
    updateMany: mocks.updateMany,
  };
  const tx = {
    appointment,
    appointmentService: { deleteMany: vi.fn(), createMany: vi.fn() },
    service: { findMany: vi.fn(async () => []) },
  };
  return {
    prisma: {
      appointment,
      doctor: { findFirst: mocks.doctorFindFirst },
      service: { findMany: vi.fn(async () => []) },
      $transaction: mocks.transaction.mockImplementation(
        async (fn: (t: unknown) => unknown) => fn(tx),
      ),
    },
  };
});
vi.mock("@/server/appointments/cancel", () => ({
  cancelAppointment: mocks.cancelAppointment,
}));
vi.mock("@/server/services/appointments", () => ({
  computeEndDate: (d: Date, min: number) => new Date(d.getTime() + min * 60_000),
  detectConflicts: mocks.detectConflicts,
  isOfferedSlotStart: vi.fn(async () => true),
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(),
  recomputeCaseAppointments: vi.fn(),
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: mocks.fireTrigger }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: mocks.publishViaOutbox,
}));

import { PATCH } from "@/app/api/miniapp/appointments/[id]/route";
import { hasArrivedForVisit } from "@/lib/appointments/patient-reschedule";

function patch(id: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`http://x/api/miniapp/appointments/${id}?clinicSlug=neurofax`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Inside the 14 day booking horizon of the moves below.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T03:00:00Z") });
  state.row = { ...WALKIN_ROW };
  mocks.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    ...state.row,
    ...args.data,
  }));
  mocks.updateMany.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    state.row = { ...state.row, ...args.data };
    return { count: 1 };
  });
  mocks.doctorFindFirst.mockResolvedValue({ id: "d2" });
  mocks.detectConflicts.mockResolvedValue({ ok: true });
  mocks.publishViaOutbox.mockResolvedValue({ eventId: "ev1" });
  mocks.cancelAppointment.mockImplementation(async () => ({
    ok: true,
    appointment: { ...state.row, status: "CANCELLED" },
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

function expectNothingMoved() {
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.updateMany).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.publishViaOutbox).not.toHaveBeenCalled();
  expect(mocks.fireTrigger).not.toHaveBeenCalled();
}

describe("Mini App PATCH refuses to move an arrived visit", () => {
  it("a WAITING walk-in moved to tomorrow 10:00 is refused and stays in today's queue", async () => {
    const res = await patch("apt_w", { startAt: "2026-10-02T05:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_reschedulable" });
    expectNothingMoved();
  });

  it("changing the doctor or services of a queued visit is refused too", async () => {
    expect((await patch("apt_w", { doctorId: "d2" })).status).toBe(409);
    expect((await patch("apt_w", { serviceIds: ["s1"] })).status).toBe(409);
    expectNothingMoved();
  });

  it("a SKIPPED visit is refused (it would stay «Пропущен» on the new day)", async () => {
    state.row = { ...WALKIN_ROW, status: "SKIPPED", queueStatus: "SKIPPED" };
    const res = await patch("apt_w", { startAt: "2026-10-02T05:00:00.000Z" });
    expect(res.status).toBe(409);
    expectNothingMoved();
  });

  it("a booking after «Я на месте» is refused (tomorrow would read «вы отметились»)", async () => {
    state.row = {
      ...WALKIN_ROW,
      status: "CONFIRMED",
      queueStatus: "CONFIRMED",
      channel: "PHONE",
      ticketSeq: null,
      queuedAt: null,
      arrivedAt: new Date("2026-10-01T04:58:00Z"),
    };
    const res = await patch("apt_w", { startAt: "2026-10-02T05:00:00.000Z" });
    expect(res.status).toBe(409);
    expectNothingMoved();
  });

  it("cancel of the WAITING visit still goes through", async () => {
    const res = await patch("apt_w", { cancel: true, cancelReason: "не дождусь" });
    expect(res.status).toBe(200);
    expect(mocks.cancelAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: "apt_w", actorRole: "PATIENT" }),
    );
  });

  it("a plain booking (reception undid «Пришёл») still moves", async () => {
    state.row = {
      ...WALKIN_ROW,
      status: "BOOKED",
      queueStatus: "BOOKED",
      channel: "PHONE",
      // Frozen at the first intake, kept after WAITING → BOOKED.
      ticketSeq: 7,
    };
    const res = await patch("apt_w", { startAt: "2026-10-02T05:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    const data = mocks.updateMany.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.date).toEqual(new Date("2026-10-02T05:00:00.000Z"));
    expect(data.time).toBe("10:00");
  });
});

describe("hasArrivedForVisit", () => {
  it("is false for a booking that has not arrived", () => {
    expect(hasArrivedForVisit({ status: "BOOKED" })).toBe(false);
    expect(hasArrivedForVisit({ status: "CONFIRMED", queueStatus: "CONFIRMED", arrivedAt: null })).toBe(
      false,
    );
  });

  it("is true once the visit is queued, on the table or skipped", () => {
    expect(hasArrivedForVisit({ status: "WAITING" })).toBe(true);
    expect(hasArrivedForVisit({ status: "SKIPPED" })).toBe(true);
    // The queue column alone is enough: the two are written separately.
    expect(hasArrivedForVisit({ status: "CONFIRMED", queueStatus: "WAITING" })).toBe(true);
    expect(hasArrivedForVisit({ status: "BOOKED", queueStatus: "IN_PROGRESS" })).toBe(true);
  });

  it("is true after «Я на месте», as a Date (server) or an ISO string (client)", () => {
    expect(hasArrivedForVisit({ status: "BOOKED", arrivedAt: new Date() })).toBe(true);
    expect(hasArrivedForVisit({ status: "BOOKED", arrivedAt: "2026-10-01T04:58:00.000Z" })).toBe(
      true,
    );
  });
});
