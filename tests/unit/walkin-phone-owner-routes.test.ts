import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit Q-03 / PH-01 at the HTTP edges:
 *   - the doctor's / front desk's walk-in answers 409 with the number's
 *     owner so the dialog can ask «same person?», and forwards the answer;
 *   - the kiosk gets the same 409 with a MASKED owner name;
 *   - the kiosk's «Это вы?» lookup only ever finds the VERIFIED owner;
 *   - CRM «new patient» reports a duplicate only for a verified owner,
 *     and takes a number away from a card that merely claimed it.
 */

const state = vi.hoisted(() => ({
  walkinCalls: [] as Array<Record<string, unknown>>,
  walkinResult: null as unknown,
  owner: null as null | { id: string; fullName: string; birthDate: Date | null },
  released: [] as Array<{ phone: string; reason: string }>,
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "RECEPTIONIST" };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx,
        }),
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));

vi.mock("@/server/appointments/walkin", () => ({
  registerWalkin: vi.fn(async (input: Record<string, unknown>) => {
    state.walkinCalls.push(input);
    return state.walkinResult;
  }),
}));

vi.mock("@/server/clinic-public/resolve", () => ({
  resolvePublicClinic: vi.fn(async () => ({
    ok: true,
    ctx: { clinicId: "c1", clinicSlug: "neurofax" },
  })),
}));

vi.mock("@/server/kiosk/device", () => ({
  requireKioskFor: vi.fn(async () => ({ ok: true })),
  authenticateKiosk: vi.fn(async () => ({ clinicId: "c1" })),
  kioskUnauthorized: () => new Response(null, { status: 401 }),
  realClientIp: () => "10.0.0.1",
  maskPatientName: (n: string) => `${n.split(" ")[0]} ${n.split(" ")[1]?.[0] ?? ""}.`,
}));

vi.mock("@/server/patient/phone-identity", () => ({
  findVerifiedPhoneOwner: vi.fn(async () => state.owner),
  releaseUnverifiedPhone: vi.fn(async (_db: unknown, _c: string, phone: string, reason: string) => {
    state.released.push({ phone, reason });
    return [];
  }),
  isUniqueViolation: () => false,
}));

vi.mock("@/server/services/patient-number", () => ({
  allocatePatientNumber: vi.fn(async () => 101),
}));

vi.mock("@/lib/prisma", () => {
  const patient = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.created.push(data);
      return { id: "p_new", ...data };
    }),
  };
  return {
    prisma: {
      patient,
      appointment: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ patient })),
    },
  };
});

beforeEach(() => {
  state.walkinCalls = [];
  state.walkinResult = null;
  state.owner = null;
  state.released = [];
  state.created = [];
});

const MISMATCH = {
  ok: false,
  reason: "phone_owner_mismatch",
  owner: { id: "p_mother", fullName: "Каримова Дилноза Рустамовна", birthYear: 1985 },
};

function json(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/crm/appointments/walkin", () => {
  it("409 phone_owner_mismatch carries the owner's name and birth year for the dialog", async () => {
    state.walkinResult = MISMATCH;
    const { POST } = await import("@/app/api/crm/appointments/walkin/route");
    const res = await POST(
      json("https://x/api/crm/appointments/walkin", {
        doctorId: "doc_1",
        newPatient: { fullName: "Каримов Тимур 2012", phone: "+998901234567" },
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      reason: "phone_owner_mismatch",
      owner: MISMATCH.owner,
    });
  });

  it("forwards the staff's answer to registerWalkin", async () => {
    state.walkinResult = MISMATCH;
    const { POST } = await import("@/app/api/crm/appointments/walkin/route");
    await POST(
      json("https://x/api/crm/appointments/walkin", {
        doctorId: "doc_1",
        newPatient: { fullName: "Каримов Тимур", phone: "+998901234567", phoneOwner: "other" },
      }),
    );
    expect(state.walkinCalls[0]!.patient).toEqual({
      fullName: "Каримов Тимур",
      phone: "+998901234567",
      phoneOwner: "other",
    });
  });
});

describe("POST /api/c/[slug]/queue/walkin (kiosk)", () => {
  it("409 with the owner's name MASKED: typing a number must not reveal whose it is", async () => {
    state.walkinResult = MISMATCH;
    const { POST } = await import("@/app/api/c/[slug]/queue/walkin/route");
    const res = await POST(
      json("https://x/api/c/neurofax/queue/walkin", {
        fullName: "Каримов Тимур",
        phone: "+998901234567",
        doctorId: "doc_1",
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("phone_owner_mismatch");
    expect(body.owner).toEqual({ fullName: "Каримова Д." });
  });

  it("passes the kiosk's «Это вы?» answer through", async () => {
    state.walkinResult = MISMATCH;
    const { POST } = await import("@/app/api/c/[slug]/queue/walkin/route");
    await POST(
      json("https://x/api/c/neurofax/queue/walkin", {
        fullName: "Каримова Д.",
        phone: "+998901234567",
        doctorId: "doc_1",
        phoneOwner: "same",
      }),
    );
    expect(state.walkinCalls[0]!.patient).toMatchObject({ phoneOwner: "same" });
  });
});

describe("GET /api/kiosk/checkin", () => {
  it("looks the number up through the VERIFIED-owner helper only", async () => {
    const { findVerifiedPhoneOwner } = await import("@/server/patient/phone-identity");
    state.owner = { id: "p_mother", fullName: "Каримова Дилноза", birthDate: null };
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    const res = await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"));
    expect(res.status).toBe(200);
    expect(findVerifiedPhoneOwner).toHaveBeenCalledWith(expect.anything(), "c1", "+998901234567");
    const body = await res.json();
    expect(body.patient).toEqual({ id: "p_mother", fullName: "Каримова Д." });
  });

  it("a number nobody verifiably owns is «first visit»", async () => {
    state.owner = null;
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    const res = await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"));
    expect((await res.json()).patient).toBeNull();
  });
});

describe("POST /api/crm/patients", () => {
  it("a verified owner is a duplicate (409 with its id), as before", async () => {
    state.owner = { id: "p_owner", fullName: "Каримова Дилноза", birthDate: null };
    const { POST } = await import("@/app/api/crm/patients/route");
    const res = await POST(
      json("https://x/api/crm/patients", { fullName: "Каримова Дилноза", phone: "+998901234567" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      reason: "phone_already_exists",
      patientId: "p_owner",
    });
    expect(state.created).toHaveLength(0);
  });

  it("a number only claimed in the Mini App is NOT handed back: the claim is released and a verified card created", async () => {
    state.owner = null;
    const { POST } = await import("@/app/api/crm/patients/route");
    const res = await POST(
      json("https://x/api/crm/patients", { fullName: "Юсупова Лола", phone: "+998901234567" }),
    );
    expect(res.status).toBe(201);
    expect(state.released).toEqual([{ phone: "+998901234567", reason: "crm_create" }]);
    expect(state.created[0]).toMatchObject({
      phoneNormalized: "+998901234567",
      phoneVerifiedAt: expect.any(Date),
    });
  });
});
