import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit Q-01: a patient with a booking (BOOKED / CONFIRMED) could not check in
 * at the kiosk. The lookup asked only for WAITING/IN_PROGRESS rows, so her
 * booking never showed, the kiosk sent her to «choose a doctor» and she got a
 * second, walk-in visit; the NO_SHOW sweep later closed the real booking. And
 * the check-in itself flipped only BOOKED rows, leaving a CONFIRMED booking
 * with a printed ticket but `status=CONFIRMED` and no `queuedAt`.
 */

type Row = {
  id: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  date: Date;
  time: string;
  status: string;
  queueStatus: string;
  queueOrder: number | null;
  ticketSeq: number | null;
  queuedAt: Date | null;
  startedAt?: Date | null;
  ticketCode: string;
  patient: { id: string; fullName: string };
  doctor: {
    id: string;
    nameRu: string;
    nameUz: string;
    color: string | null;
    cabinet: { number: string } | null;
  };
};

const state = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  findManyArgs: [] as Array<Record<string, unknown>>,
  findManyResult: [] as Array<Record<string, unknown>>,
  events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  allocations: 0,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));

vi.mock("@/server/clinic-public/resolve", () => ({
  resolvePublicClinic: vi.fn(async () => ({
    ok: true,
    ctx: { clinicId: "c1", clinicSlug: "neurofax" },
  })),
}));

vi.mock("@/server/kiosk/device", () => ({
  requireKioskFor: vi.fn(async () => ({ ok: true })),
  authenticateKiosk: vi.fn(async () => ({ clinicId: "c1", clinicSlug: "neurofax" })),
  kioskUnauthorized: () => new Response(null, { status: 401 }),
  realClientIp: () => "10.0.0.1",
  maskPatientName: (n: string) => n.split(" ")[0],
}));

vi.mock("@/server/patient/phone-identity", () => ({
  findVerifiedPhoneOwner: vi.fn(async () => ({
    id: "p1",
    fullName: "Каримова Дилноза",
    birthDate: null,
  })),
  findPhoneClaim: vi.fn(async () => null),
}));

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn((_c: string, e: { type: string; payload: Record<string, unknown> }) => {
    state.events.push(e);
  }),
}));

vi.mock("@/server/appointments/queue-order", () => ({
  runQueueTx: async (fn: (tx: unknown) => unknown) => fn(txMock),
  allocateQueueOrder: vi.fn(async () => {
    state.allocations += 1;
    return { queueOrder: 7, ticketSeq: 12 };
  }),
}));

const txMock = {
  appointment: {
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.updates.push(data);
      Object.assign(state.row!, data);
      const r = state.row!;
      return {
        queueStatus: r.queueStatus,
        status: r.status,
        queueOrder: r.queueOrder,
        ticketSeq: r.ticketSeq,
      };
    }),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findFirst: vi.fn(async () => (state.row ? { ...state.row } : null)),
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        state.findManyArgs.push(args);
        return state.findManyResult;
      }),
    },
  },
}));

import { tashkentDayBounds } from "@/lib/booking-validation";

function todayRow(overrides: Partial<Row> = {}): Row {
  const { dayStart } = tashkentDayBounds();
  return {
    id: "a1",
    clinicId: "c1",
    doctorId: "d1",
    patientId: "p1",
    // 23:00 Tashkent today: always «today», whatever time the suite runs.
    date: new Date(dayStart.getTime() + 23 * 60 * 60_000),
    time: "23:00",
    status: "CONFIRMED",
    queueStatus: "CONFIRMED",
    queueOrder: null,
    ticketSeq: null,
    queuedAt: null,
    ticketCode: "TK-1",
    patient: { id: "p1", fullName: "Каримова Дилноза" },
    doctor: {
      id: "d1",
      nameRu: "Невролог",
      nameUz: "Nevrolog",
      color: null,
      cabinet: { number: "3" },
    },
    ...overrides,
  };
}

function checkin() {
  return new Request("https://neurofax.uz/api/c/neurofax/queue/checkin", {
    method: "POST",
    headers: { "content-type": "application/json", "x-kiosk-token": "t".repeat(32) },
    body: JSON.stringify({ appointmentId: "a1" }),
  });
}

beforeEach(() => {
  state.row = null;
  state.updates = [];
  state.findManyArgs = [];
  state.findManyResult = [];
  state.events = [];
  state.allocations = 0;
});

describe("GET /api/kiosk/checkin — which bookings the kiosk offers", () => {
  it("asks for today's BOOKED / CONFIRMED / SKIPPED bookings too, and future BOOKED / CONFIRMED", async () => {
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"));

    const where = state.findManyArgs[0]!.where as {
      OR: Array<{ queueStatus: { in: string[] } }>;
    };
    const [today, upcoming] = where.OR;
    expect(today!.queueStatus.in).toEqual(
      expect.arrayContaining(["BOOKED", "CONFIRMED", "WAITING", "IN_PROGRESS", "SKIPPED"]),
    );
    expect(upcoming!.queueStatus.in.sort()).toEqual(["BOOKED", "CONFIRMED"]);
  });

  it("a CONFIRMED booking today is offered for check-in, tomorrow's is shown as «У вас есть запись»", async () => {
    const { dayStart, dayEnd } = tashkentDayBounds();
    state.findManyResult = [
      {
        id: "today",
        date: new Date(dayStart.getTime() + 14 * 60 * 60_000),
        primaryService: null,
        queueOrder: null,
        ticketSeq: null,
        queueStatus: "CONFIRMED",
        doctor: { id: "d1", nameRu: "Невролог", cabinet: { number: "3" } },
      },
      {
        id: "tomorrow",
        date: new Date(dayEnd.getTime() + 10 * 60 * 60_000),
        primaryService: null,
        queueOrder: null,
        ticketSeq: null,
        queueStatus: "BOOKED",
        doctor: { id: "d1", nameRu: "Невролог", cabinet: { number: "3" } },
      },
    ];
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    const res = await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"));
    const body = await res.json();
    expect(body.appointments.map((a: { id: string }) => a.id)).toEqual(["today"]);
    expect(body.appointments[0].queueStatus).toBe("CONFIRMED");
    expect(body.upcoming.map((a: { id: string }) => a.id)).toEqual(["tomorrow"]);
  });
});

describe("POST /api/c/[slug]/queue/checkin — a booking joins the live queue", () => {
  it("CONFIRMED → status = queueStatus = WAITING, numbered once, queuedAt stamped, reception poked", async () => {
    state.row = todayRow();
    const { POST } = await import("@/app/api/c/[slug]/queue/checkin/route");
    const res = await POST(checkin());

    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    const data = state.updates[0]!;
    expect(data.queueStatus).toBe("WAITING");
    // The sweep reads `status`: it must move too, or she is swept NO_SHOW.
    expect(data.status).toBe("WAITING");
    expect(data.queuedAt).toBeInstanceOf(Date);
    expect(data).toMatchObject({ queueOrder: 7, ticketSeq: 12 });
    expect(state.allocations).toBe(1);

    const body = await res.json();
    expect(body.ticketNumber).toBeTruthy();
    expect(state.events.map((e) => e.type)).toEqual([
      "queue.updated",
      "appointment.statusChanged",
    ]);
    expect(state.events[1]!.payload).toMatchObject({
      status: "WAITING",
      previousStatus: "CONFIRMED",
    });
  });

  it("BOOKED gets the same intake", async () => {
    state.row = todayRow({ status: "BOOKED", queueStatus: "BOOKED" });
    const { POST } = await import("@/app/api/c/[slug]/queue/checkin/route");
    await POST(checkin());
    expect(state.updates[0]).toMatchObject({ queueStatus: "WAITING", status: "WAITING" });
  });

  it("SKIPPED coming back → WAITING at the back of the line, keeping the printed number", async () => {
    const earlier = new Date(Date.now() - 60 * 60_000);
    state.row = todayRow({
      status: "SKIPPED",
      queueStatus: "SKIPPED",
      queueOrder: 3,
      ticketSeq: 3,
      queuedAt: earlier,
    });
    const { POST } = await import("@/app/api/c/[slug]/queue/checkin/route");
    const res = await POST(checkin());
    const data = state.updates[0]!;
    expect(data).toMatchObject({ queueStatus: "WAITING", status: "WAITING" });
    expect(data.queueOrder).toBeUndefined();
    expect(data.ticketSeq).toBeUndefined();
    expect((data.queuedAt as Date).getTime()).toBeGreaterThan(earlier.getTime());
    expect(state.allocations).toBe(0);
    expect((await res.json()).queueOrder).toBe(3);
  });

  it("a second tap on a WAITING row only reprints the same ticket", async () => {
    state.row = todayRow({
      status: "WAITING",
      queueStatus: "WAITING",
      queueOrder: 4,
      ticketSeq: 9,
      queuedAt: new Date(),
    });
    const { POST } = await import("@/app/api/c/[slug]/queue/checkin/route");
    const res = await POST(checkin());
    expect(state.updates).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect((await res.json()).queueOrder).toBe(4);
  });

  it("never puts an IN_PROGRESS visit back into WAITING", async () => {
    state.row = todayRow({
      status: "IN_PROGRESS",
      queueStatus: "IN_PROGRESS",
      queueOrder: 2,
      ticketSeq: 2,
      queuedAt: new Date(),
    });
    const { POST } = await import("@/app/api/c/[slug]/queue/checkin/route");
    const res = await POST(checkin());
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(0);
  });

  it("still refuses closed visits", async () => {
    state.row = todayRow({ status: "NO_SHOW", queueStatus: "NO_SHOW" });
    const { POST } = await import("@/app/api/c/[slug]/queue/checkin/route");
    const res = await POST(checkin());
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});
