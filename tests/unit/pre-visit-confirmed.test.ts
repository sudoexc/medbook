/**
 * Audit MA-09: the pre-visit questionnaire was closed for CONFIRMED visits.
 *
 * Phone and kiosk bookings are created CONFIRMED and reminder answers
 * confirm the rest, yet the 24h push, the POST and the screen only knew
 * BOOKED/WAITING: most patients coming tomorrow got no questionnaire, and
 * one who opened it anyway was told «запись уже завершена». The form is now
 * open for every visit still ahead, and a closed one says why.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appt: null as Record<string, unknown> | null,
  updates: [] as unknown[],
  findManyWhere: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/prisma", () => {
  const appointment = {
    findFirst: vi.fn(async () => state.appt),
    findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
      state.findManyWhere = args.where;
      return [];
    }),
    update: vi.fn(async (args: unknown) => {
      state.updates.push(args);
      return {};
    }),
  };
  return {
    prisma: {
      appointment,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ appointment })),
    },
  };
});

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

vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p1",
    isOnBehalfOf: false,
    preferredLang: "RU",
  })),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => ({ eventId: "ev1" })),
}));
vi.mock("@/server/notifications/triggers", () => ({
  onPreVisitQuestionnaire: vi.fn(async () => undefined),
}));
vi.mock("@/server/queue", () => ({ getQueue: () => ({}) }));

import {
  isPreVisitEligible,
  isPreVisitOpenStatus,
  preVisitClosedReason,
} from "@/lib/patient-experience/pre-visit";
import { POST } from "@/app/api/miniapp/pre-visit/[appointmentId]/route";
import { runPreVisitTick } from "@/server/workers/pre-visit-questionnaire";

const now = new Date("2026-10-01T10:00:00.000Z");
const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

function apptWith(status: string) {
  return {
    id: "a1",
    clinicId: "c1",
    patientId: "p1",
    date: in24h,
    status,
    preVisitData: null,
    preVisitSubmittedAt: null,
    doctor: { nameRu: "Султанов Азиз", nameUz: "Sultonov Aziz" },
  };
}

function submit() {
  return POST(
    new Request("http://x/api/miniapp/pre-visit/a1?clinicSlug=neurofax", {
      method: "POST",
      body: JSON.stringify({
        complaints: "головная боль",
        allergies: [],
        medications: [],
        notes: "",
      }),
    }),
  );
}

beforeEach(() => {
  state.appt = null;
  state.updates.length = 0;
  state.findManyWhere = null;
});

describe("pre-visit status gate", () => {
  it("is open for every visit still ahead, CONFIRMED included", () => {
    for (const s of ["BOOKED", "CONFIRMED", "WAITING"]) {
      expect(isPreVisitOpenStatus(s), s).toBe(true);
      expect(preVisitClosedReason(s), s).toBeNull();
    }
  });

  it("names why the form is closed", () => {
    expect(preVisitClosedReason("CANCELLED")).toBe("cancelled");
    expect(preVisitClosedReason("COMPLETED")).toBe("completed");
    expect(preVisitClosedReason("NO_SHOW")).toBe("no_show");
    expect(preVisitClosedReason("IN_PROGRESS")).toBe("in_progress");
    expect(preVisitClosedReason("SKIPPED")).toBe("closed");
  });

  it("sends the 24h push for a CONFIRMED (phone) booking", () => {
    expect(
      isPreVisitEligible(
        {
          startsAt: in24h,
          status: "CONFIRMED",
          preVisitNotifiedAt: null,
          preVisitSubmittedAt: null,
          patientHasContact: true,
        },
        now,
      ),
    ).toBe(true);
  });

  it("the worker scans CONFIRMED visits too", async () => {
    await runPreVisitTick(now);
    const where = state.findManyWhere as { status: { in: string[] } };
    expect(where.status.in).toEqual(expect.arrayContaining(["BOOKED", "CONFIRMED", "WAITING"]));
  });
});

describe("POST /api/miniapp/pre-visit/:id", () => {
  it("accepts the questionnaire for a CONFIRMED visit", async () => {
    state.appt = apptWith("CONFIRMED");
    const res = await submit();
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
  });

  it("refuses a cancelled visit and says it was cancelled", async () => {
    state.appt = apptWith("CANCELLED");
    const res = await submit();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      reason: "appointment_not_open",
      status: "CANCELLED",
      closedReason: "cancelled",
    });
    expect(state.updates).toHaveLength(0);
  });
});
