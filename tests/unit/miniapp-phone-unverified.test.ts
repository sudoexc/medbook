import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit PH-01 / MA-04: the Mini App no longer writes a typed phone into the
 * card.
 *   - a typed number proved nothing, yet walk-in and CRM lookups matched
 *     patients by phone, so anyone could claim a stranger's number and later
 *     receive her visits;
 *   - profile answered 409 «phone_taken», an oracle for «is this number a
 *     patient here»;
 *   - booking with the number of an existing clinic card broke the unique
 *     index and failed with 500 on every attempt.
 */

const state = vi.hoisted(() => ({
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  booked: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/server/miniapp/handler", () => {
  const ctx = {
    clinicId: "c1",
    clinicSlug: "neurofax",
    patientId: "p_tg",
    patient: {
      id: "p_tg",
      fullName: "Dilnoza",
      phone: "tg:111",
      preferredLang: "RU",
      telegramId: "111",
      telegramUsername: null,
    },
    tgUser: { id: 111 },
  };
  const wrap =
    (
      opts: { bodySchema?: { parse: (v: unknown) => unknown } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const raw = request.method === "GET" ? undefined : await request.json();
      const body = opts?.bodySchema ? opts.bodySchema.parse(raw) : raw;
      return handler({ request, body, ctx });
    };
  return {
    createMiniAppHandler: wrap,
    createMiniAppListHandler: (_o: unknown, h: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) => h({ request, ctx }),
  };
});

vi.mock("@/lib/prisma", () => {
  const row = {
    id: "p_tg",
    fullName: "Dilnoza",
    phone: "tg:111",
    phoneNormalized: "tg:111",
    phoneVerifiedAt: null,
    preferredLang: "RU",
    consentMarketing: false,
    marketingOptOut: false,
    telegramUsername: null,
  };
  const patient = {
    findFirst: vi.fn(async () => ({ ...row })),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        state.updates.push({ id: where.id, data });
        // The unique (clinicId, phoneNormalized) index: this number is
        // already a clinic card.
        if (data.phoneNormalized === "+998901234567") {
          const e = new Error("Unique constraint failed") as Error & { code?: string };
          e.code = "P2002";
          throw e;
        }
        return { ...row, ...data };
      },
    ),
  };
  return {
    prisma: {
      patient,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ patient })),
    },
  };
});

vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/miniapp/idempotency", () => ({
  withIdempotency: (_r: Request, _s: unknown, fn: () => Promise<Response>) => fn(),
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p_tg",
    isOnBehalfOf: false,
    preferredLang: "RU",
  })),
}));
vi.mock("@/server/observability/metrics", () => ({
  getMetrics: () => ({ bookingDuration: { observe: () => undefined } }),
}));
vi.mock("@/server/appointments/book", () => ({
  bookAppointment: vi.fn(async (input: Record<string, unknown>) => {
    state.booked.push(input);
    return {
      ok: true,
      appointment: {
        id: "apt_1",
        date: new Date("2026-10-01T05:00:00Z"),
        endDate: new Date("2026-10-01T05:30:00Z"),
        time: "10:00",
        ticketCode: "ABC123",
        durationMin: 30,
        priceFinal: 100,
        status: "BOOKED",
      },
      caseAttach: null,
    };
  }),
}));

beforeEach(() => {
  state.updates = [];
  state.booked = [];
});

function post(path: string, body: unknown) {
  return new Request(`https://neurofax.uz${path}?clinicSlug=neurofax`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/miniapp/profile", () => {
  it("ignores a typed phone: nothing is written, and there is no «phone_taken» oracle", async () => {
    const { POST } = await import("@/app/api/miniapp/profile/route");
    const res = await POST(post("/api/miniapp/profile", { phone: "+998901234567" }));
    expect(res.status).toBe(200);
    for (const u of state.updates) {
      expect(u.data).not.toHaveProperty("phone");
      expect(u.data).not.toHaveProperty("phoneNormalized");
    }
    const body = await res.json();
    expect(body.patient).toMatchObject({ hasPhone: false, phone: "", phoneVerified: false });
  });

  it("still saves name and language", async () => {
    const { POST } = await import("@/app/api/miniapp/profile/route");
    const res = await POST(
      post("/api/miniapp/profile", { fullName: "Каримова Дилноза", phone: "+998901234567", lang: "UZ" }),
    );
    expect(res.status).toBe(200);
    expect(state.updates[0]!.data).toEqual({ fullName: "Каримова Дилноза", preferredLang: "UZ" });
  });
});

describe("POST /api/miniapp/appointments", () => {
  it("booking with the number of an existing clinic card no longer 500s: the phone is ignored, the booking goes through", async () => {
    const { POST } = await import("@/app/api/miniapp/appointments/route");
    const res = await POST(
      post("/api/miniapp/appointments", {
        doctorId: "doc_1",
        serviceIds: ["svc_1"],
        startAt: "2026-10-01T05:00:00.000Z",
        patientName: "Dilnoza",
        patientPhone: "+998901234567",
      }),
    );
    expect(res.status).toBe(201);
    expect(state.booked).toHaveLength(1);
    for (const u of state.updates) {
      expect(u.data).not.toHaveProperty("phone");
      expect(u.data).not.toHaveProperty("phoneNormalized");
    }
  });
});
