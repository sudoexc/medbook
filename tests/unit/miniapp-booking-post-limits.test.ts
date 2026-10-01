/**
 * Audit MA-14 (and MA-19) at the Mini App booking route.
 *
 * Acceptance: the 4th booked visit of one patient answers 409 limit; a
 * start off the grid or past the horizon answers 400; a service the doctor
 * does not offer answers 404. Also: no more than 3 services per booking, a
 * per-account attempt budget (429), the limit counted for the RELATIVE the
 * booking is for, and no referral reward lookup while the program is off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  linkedCount: 1,
  onGrid: true,
  bookInputs: [] as Array<Record<string, unknown>>,
  bookResult: null as Record<string, unknown> | null,
  owner: "p_owner",
}));

vi.mock("@/server/miniapp/handler", () => {
  // Like the real wrapper: a body that fails the schema is a 400.
  const wrap =
    (
      opts: { bodySchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      let body: unknown;
      if (opts?.bodySchema) {
        const parsed = opts.bodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: "ValidationError" }, { status: 400 });
        }
        body = parsed.data;
      }
      return handler({
        request,
        body,
        ctx: {
          clinicId: "c1",
          clinicSlug: "neurofax",
          patientId: state.owner,
          patient: { id: state.owner, fullName: "Dilnoza", preferredLang: "RU" },
        },
      });
    };
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceOnDoctor: { count: vi.fn(async () => state.linkedCount) },
    service: { findMany: vi.fn(async () => [{ durationMin: 30 }]) },
    patient: { update: vi.fn() },
  },
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async ({ onBehalfOf }: { onBehalfOf?: string | null }) => ({
    ok: true,
    patientId: onBehalfOf ?? state.owner,
    isOnBehalfOf: Boolean(onBehalfOf),
    preferredLang: "RU",
    ownerPatientId: state.owner,
  })),
}));
vi.mock("@/server/miniapp/idempotency", () => ({
  withIdempotency: (_r: Request, _s: unknown, fn: () => Promise<Response>) => fn(),
}));
vi.mock("@/server/observability/metrics", () => ({
  getMetrics: () => ({ bookingDuration: { observe: () => undefined } }),
}));
vi.mock("@/server/services/appointments", () => ({
  isOfferedSlotStart: vi.fn(async () => state.onGrid),
}));
vi.mock("@/server/appointments/book", () => ({
  bookAppointment: vi.fn(async (input: Record<string, unknown>) => {
    state.bookInputs.push(input);
    return (
      state.bookResult ?? {
        ok: true,
        appointment: {
          id: "apt_1",
          date: new Date("2026-10-05T05:00:00Z"),
          endDate: new Date("2026-10-05T05:30:00Z"),
          time: "10:00",
          ticketCode: "ABC123",
          durationMin: 30,
          priceFinal: 100,
          status: "BOOKED",
        },
        caseAttach: null,
      }
    );
  }),
}));

import { POST } from "@/app/api/miniapp/appointments/route";

let owner = 0;
function book(body: Record<string, unknown>) {
  return POST(
    new Request("http://x/api/miniapp/appointments?clinicSlug=neurofax", {
      method: "POST",
      body: JSON.stringify({
        doctorId: "d1",
        serviceIds: ["s1"],
        startAt: "2026-10-05T05:00:00.000Z",
        ...body,
      }),
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T03:00:00Z") });
  state.linkedCount = 1;
  state.onGrid = true;
  state.bookInputs = [];
  state.bookResult = null;
  // A fresh Telegram account per test: the attempt budget is per account.
  owner += 1;
  state.owner = `p_owner_${owner}`;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/miniapp/appointments limits", () => {
  it("books a start the picker offers, inside the horizon", async () => {
    const res = await book({});
    expect(res.status).toBe(201);
    expect(state.bookInputs).toHaveLength(1);
  });

  it("a start past the 14 day horizon is 400 and books nothing", async () => {
    const res = await book({ startAt: "2026-10-20T05:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "beyond_horizon" });
    expect((await book({ startAt: "2027-03-01T05:00:00.000Z" })).status).toBe(400);
    expect(state.bookInputs).toHaveLength(0);
  });

  it("a start off the doctor's grid is 400 and books nothing", async () => {
    state.onGrid = false;
    const res = await book({ startAt: "2026-10-05T05:07:00.000Z" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "off_grid" });
    expect(state.bookInputs).toHaveLength(0);
  });

  it("a service the doctor does not offer is 404", async () => {
    state.linkedCount = 0;
    const res = await book({ serviceIds: ["s_other"] });
    expect(res.status).toBe(404);
    expect(state.bookInputs).toHaveLength(0);
  });

  it("more than 3 services in one booking is refused by the schema", async () => {
    const res = await book({ serviceIds: ["s1", "s2", "s3", "s4"] });
    expect(res.status).toBe(400);
    expect(state.bookInputs).toHaveLength(0);
  });

  it("repeated service ids collapse to one line", async () => {
    await book({ serviceIds: ["s1", "s1"] });
    expect(state.bookInputs[0]!.services).toEqual([{ serviceId: "s1", quantity: 1 }]);
  });

  it("the kernel's limit refusal is a 409 naming the limit", async () => {
    state.bookResult = { ok: false, reason: "booking_limit", limit: "patient_total" };
    const res = await book({});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "conflict",
      reason: "booking_limit",
      limit: "patient_total",
    });
  });

  it("the guard counts the relative's bookings when booking for her", async () => {
    await book({ onBehalfOf: "p_mama" });
    const input = state.bookInputs[0]!;
    expect(input.patientId).toBe("p_mama");
    const findMany = vi.fn(async () => [{ doctorId: "d2" }, { doctorId: "d3" }, { doctorId: "d4" }]);
    const guard = input.guard as (tx: unknown) => Promise<unknown>;
    expect(await guard({ appointment: { findMany } })).toEqual({
      reason: "booking_limit",
      limit: "patient_total",
    });
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0]
      .where;
    expect(where.patientId).toBe("p_mama");
  });

  it("MA-19: no referral reward is looked up while the program is off", async () => {
    await book({});
    expect(state.bookInputs[0]!.applyReferralReward).toBe(false);
  });

  it("one Telegram account gets 10 attempts per window, then 429", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await book({})).status).toBe(201);
    }
    const res = await book({});
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(state.bookInputs).toHaveLength(10);
    // Another account is not affected.
    state.owner = "p_someone_else";
    expect((await book({})).status).toBe(201);
  });
});
