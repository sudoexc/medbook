/**
 * Audit MA-11, the routes behind the treatment-plan card.
 *
 *   - GET /api/miniapp/treatment-plan looked for the next visit with
 *     `status: "BOOKED"` only, so a CONFIRMED follow-up (phone bookings,
 *     reminder answers) read «nothing booked», and an OPEN case with one
 *     visit was «Лечение завершено».
 *   - The card's «Записаться» carried `?caseId=`, which the booking ignored:
 *     the visit landed wherever the open-case guess put it. The booking POST
 *     now forwards it to the case-attach step as the preferred case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  nextWhere: null as Record<string, unknown> | null,
  bookInput: null as Record<string, unknown> | null,
}));

vi.mock("@/server/miniapp/handler", () => {
  const ctx = {
    clinicId: "c1",
    clinicSlug: "neurofax",
    patientId: "p1",
    patient: { id: "p1", fullName: "Dilnoza", preferredLang: "RU" },
  };
  const wrap =
    (
      opts: { bodySchema?: { parse: (v: unknown) => unknown } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const body = opts?.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined;
      return handler({ request, body, ctx });
    };
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    medicalCase: {
      findMany: vi.fn(async () => [
        {
          id: "case_head",
          title: "Мигрень",
          status: "OPEN",
          primaryComplaint: null,
          diagnosisText: null,
          openedAt: new Date("2026-09-01T05:00:00Z"),
          primaryDoctor: null,
        },
      ]),
    },
    appointment: {
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        state.nextWhere = args.where;
        return { id: "a_next", date: new Date("2026-10-05T05:00:00Z"), time: "10:00" };
      }),
    },
    patient: { update: vi.fn() },
    serviceOnDoctor: { count: vi.fn(async () => 1) },
    // Its length, for the slot-grid check (MA-14).
    service: { findMany: vi.fn(async () => [{ durationMin: 30 }]) },
  },
}));

vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p1",
    isOnBehalfOf: false,
    preferredLang: "RU",
  })),
}));
vi.mock("@/server/miniapp/idempotency", () => ({
  withIdempotency: (_r: Request, _s: unknown, fn: () => Promise<Response>) => fn(),
}));
vi.mock("@/server/observability/metrics", () => ({
  getMetrics: () => ({ bookingDuration: { observe: () => undefined } }),
}));
// The start is one the picker offers (MA-14 grid, tested on its own).
vi.mock("@/server/services/appointments", () => ({
  isOfferedSlotStart: vi.fn(async () => true),
}));
vi.mock("@/server/appointments/book", () => ({
  bookAppointment: vi.fn(async (input: Record<string, unknown>) => {
    state.bookInput = input;
    return {
      ok: true,
      appointment: {
        id: "a_new",
        date: new Date("2026-10-05T05:00:00Z"),
        endDate: new Date("2026-10-05T05:30:00Z"),
        time: null,
        ticketCode: "K7M2QX",
        durationMin: 30,
        priceFinal: 0,
        status: "BOOKED",
      },
      caseAttach: { kind: "auto", caseId: "case_head" },
    };
  }),
}));

import { GET as getPlan } from "@/app/api/miniapp/treatment-plan/route";
import { POST as book } from "@/app/api/miniapp/appointments/route";

beforeEach(() => {
  state.nextWhere = null;
  state.bookInput = null;
});

describe("GET /api/miniapp/treatment-plan", () => {
  it("finds a CONFIRMED or WAITING next visit and never calls an OPEN case finished", async () => {
    const res = await getPlan(new Request("http://x/api/miniapp/treatment-plan?clinicSlug=neurofax"));
    expect(res.status).toBe(200);
    const where = state.nextWhere as { status: { in: string[] }; medicalCaseId: string };
    expect(where.medicalCaseId).toBe("case_head");
    expect(where.status.in).toEqual(expect.arrayContaining(["BOOKED", "CONFIRMED", "WAITING"]));

    const body = (await res.json()) as {
      active: { progress: Record<string, unknown>; nextBooked: unknown };
    };
    expect(body.active.progress).toMatchObject({
      done: 1,
      total: null,
      progress: null,
      completed: false,
      nextVisitAt: "2026-10-05T05:00:00.000Z",
    });
    expect(body.active.nextBooked).toMatchObject({ id: "a_next" });
  });
});

describe("POST /api/miniapp/appointments with the case from the plan card", () => {
  // The booked start lies inside the 14 day booking horizon (MA-14).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T03:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands the case to the case-attach step as the preferred one", async () => {
    const res = await book(
      new Request("http://x/api/miniapp/appointments?clinicSlug=neurofax", {
        method: "POST",
        body: JSON.stringify({
          doctorId: "d1",
          serviceIds: ["s1"],
          startAt: "2026-10-05T05:00:00.000Z",
          medicalCaseId: "case_head",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const opts = state.bookInput!.autoAttachCaseOptions as Record<string, unknown>;
    expect(opts.preferredCaseId).toBe("case_head");
    // A hint for the guarded attach step, never written blindly at create.
    expect(state.bookInput!.medicalCaseId).toBeUndefined();
  });

  it("books as before without one", async () => {
    await book(
      new Request("http://x/api/miniapp/appointments?clinicSlug=neurofax", {
        method: "POST",
        body: JSON.stringify({
          doctorId: "d1",
          serviceIds: ["s1"],
          startAt: "2026-10-05T05:00:00.000Z",
        }),
      }),
    );
    const opts = state.bookInput!.autoAttachCaseOptions as Record<string, unknown>;
    expect(opts.preferredCaseId).toBeNull();
  });
});
