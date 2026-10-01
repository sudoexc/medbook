import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit TG-09 review: the questionnaire worker sends to CONFIRMED visits
 * (every phone and kiosk booking, and every patient who tapped
 * «✅ Подтверждаю»), but the Mini App submit let only BOOKED and WAITING
 * through, so most patients filled the form and got «запись уже завершена».
 * Submit and worker now read one shared list of upcoming statuses.
 */

const state = vi.hoisted(() => ({
  status: "CONFIRMED",
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/server/miniapp/handler", () => {
  const ctx = {
    clinicId: "c1",
    clinicSlug: "neurofax",
    patientId: "p_tg",
    patient: { id: "p_tg", fullName: "Dilnoza", preferredLang: "RU" },
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

vi.mock("@/lib/prisma", () => {
  const appointment = {
    findFirst: vi.fn(async () => ({
      id: "apt_1",
      clinicId: "c1",
      patientId: "p_tg",
      date: new Date("2026-10-02T05:00:00Z"),
      status: state.status,
      preVisitData: null,
      preVisitSubmittedAt: null,
      doctor: { nameRu: "Султанов", nameUz: "Sultanov" },
    })),
    update: vi.fn(async (args: Record<string, unknown>) => {
      state.updates.push(args);
      return {};
    }),
  };
  return {
    prisma: {
      appointment,
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({ appointment })),
    },
  };
});

vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p_tg",
    isOnBehalfOf: false,
    preferredLang: "RU",
  })),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => ({ eventId: "ev1" })),
}));

import { POST } from "@/app/api/miniapp/pre-visit/[appointmentId]/route";
import { isPreVisitEligible } from "@/lib/patient-experience/pre-visit";

function submit() {
  return POST(
    new Request("http://localhost/api/miniapp/pre-visit/apt_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        complaints: "Головная боль по утрам",
        allergies: [],
        medications: [],
        notes: "",
      }),
    }),
  );
}

beforeEach(() => {
  state.status = "CONFIRMED";
  state.updates = [];
});

describe("POST /api/miniapp/pre-visit/:id (TG-09 review)", () => {
  it("saves the answers of a CONFIRMED visit", async () => {
    const res = await submit();
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
  });

  it.each(["BOOKED", "WAITING"])("still saves a %s visit", async (status) => {
    state.status = status;
    expect((await submit()).status).toBe(200);
  });

  it.each(["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "SKIPPED"])(
    "refuses a %s visit with appointment_not_open",
    async (status) => {
      state.status = status;
      const res = await submit();
      expect(res.status).toBe(409);
      expect(((await res.json()) as { reason: string }).reason).toBe("appointment_not_open");
      expect(state.updates).toEqual([]);
    },
  );

  it("accepts every status the worker sends the questionnaire for", async () => {
    const now = new Date("2026-10-01T05:00:00Z");
    for (const status of ["BOOKED", "CONFIRMED", "WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "SKIPPED"]) {
      const sent = isPreVisitEligible(
        {
          startsAt: new Date(now.getTime() + 24 * 3_600_000),
          status,
          preVisitNotifiedAt: null,
          preVisitSubmittedAt: null,
          patientHasContact: true,
        },
        now,
      );
      state.status = status;
      state.updates = [];
      const accepted = (await submit()).status === 200;
      expect(accepted, status).toBe(sent);
    }
  });
});
