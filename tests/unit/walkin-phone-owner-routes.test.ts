import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit Q-03 / PH-01 at the HTTP edges:
 *   - the doctor's / front desk's walk-in answers 409 with the number's
 *     owner so the dialog can ask «same person?», and forwards the answer;
 *   - the kiosk gets the same 409 with a MASKED owner name;
 *   - the kiosk's «Это вы?» lookup finds the VERIFIED owner, or else a Mini
 *     App claim flagged as such, so a returning Mini App patient is asked
 *     instead of being treated as a first visit;
 *   - CRM «new patient» hands back a reusable id only for the same person
 *     (matching name, or staff's explicit answer); a different name or a
 *     mere claim is a question, and «other» creates a contact-phone card;
 *   - CRM «confirm the number» verifies a claim already on the card.
 */

const state = vi.hoisted(() => ({
  walkinCalls: [] as Array<Record<string, unknown>>,
  walkinResult: null as unknown,
  owner: null as null | { id: string; fullName: string; birthDate: Date | null },
  claim: null as null | { id: string; fullName: string; birthDate: Date | null },
  sharers: [] as Array<{ id: string; fullName: string; birthDate: Date | null }>,
  verified: [] as Array<{ id: string; via: string }>,
  released: [] as Array<{ phone: string; reason: string }>,
  created: [] as Array<Record<string, unknown>>,
  // PATCH /api/crm/patients/[id]
  before: null as null | Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
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
  findPhoneClaim: vi.fn(async () => state.claim),
  findContactSharers: vi.fn(async () => state.sharers),
  verifyPhoneInPerson: vi.fn(async (_db: unknown, _c: string, id: string, via: string) => {
    state.verified.push({ id, via });
  }),
  releaseUnverifiedPhone: vi.fn(async (_db: unknown, _c: string, phone: string, reason: string) => {
    state.released.push({ phone, reason });
    return [];
  }),
  contactPhoneStub: () => "contact:stub1",
  isRealPhone: (v: string | null | undefined) => typeof v === "string" && v.startsWith("+"),
  isUniqueViolation: () => false,
}));

vi.mock("@/server/audit/patient-view", () => ({ recordPatientView: vi.fn() }));

vi.mock("@/server/services/patient-number", () => ({
  allocatePatientNumber: vi.fn(async () => 101),
}));

vi.mock("@/lib/prisma", () => {
  const patient = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.created.push(data);
      return { id: "p_new", ...data };
    }),
    findUnique: vi.fn(async () => (state.before ? { ...state.before } : null)),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.updates.push(data);
      return { ...state.before, ...data };
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
  state.claim = null;
  state.sharers = [];
  state.verified = [];
  state.released = [];
  state.created = [];
  state.before = null;
  state.updates = [];
});

const MISMATCH = {
  ok: false,
  reason: "phone_owner_mismatch",
  owner: {
    id: "p_mother",
    fullName: "Каримова Дилноза Рустамовна",
    birthYear: 1985,
    unverified: false,
  },
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
  it("asks about the VERIFIED owner first", async () => {
    const { findVerifiedPhoneOwner } = await import("@/server/patient/phone-identity");
    state.owner = { id: "p_mother", fullName: "Каримова Дилноза", birthDate: null };
    state.claim = { id: "p_claim", fullName: "Someone Else", birthDate: null };
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    const res = await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"));
    expect(res.status).toBe(200);
    expect(findVerifiedPhoneOwner).toHaveBeenCalledWith(expect.anything(), "c1", "+998901234567");
    const body = await res.json();
    expect(body.patient).toEqual({ id: "p_mother", fullName: "Каримова Д.", unverified: false });
  });

  it("review: with no verified owner, a Mini App claim goes through «Это вы?» (masked, flagged) instead of «first visit»", async () => {
    state.owner = null;
    state.claim = { id: "p_claim", fullName: "Юсупова Лола", birthDate: null };
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    const res = await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"));
    const body = await res.json();
    expect(body.patient).toEqual({ id: "p_claim", fullName: "Юсупова Л.", unverified: true });
  });

  it("a number nobody holds is «first visit»", async () => {
    state.owner = null;
    state.claim = null;
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    const res = await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"));
    expect((await res.json()).patient).toBeNull();
  });
});

describe("POST /api/crm/patients", () => {
  it("the verified owner typed by her own name is a duplicate (409 with its id)", async () => {
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

  it("review Q-03: a son on his mother's number gets a question with her summary, never a reusable id", async () => {
    state.owner = {
      id: "p_mother",
      fullName: "Каримова Дилноза Рустамовна",
      birthDate: new Date(Date.UTC(1985, 0, 1)),
    };
    const { POST } = await import("@/app/api/crm/patients/route");
    const res = await POST(
      json("https://x/api/crm/patients", { fullName: "Каримов Тимур 2012", phone: "+998901234567" }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({
      error: "conflict",
      reason: "phone_owner_mismatch",
      owner: {
        id: "p_mother",
        fullName: "Каримова Дилноза Рустамовна",
        birthYear: 1985,
        unverified: false,
      },
    });
    expect(body.patientId).toBeUndefined();
    expect(state.created).toHaveLength(0);
  });

  it("«other»: the son gets his own card; the number stays his mother's identity and only his contact phone", async () => {
    state.owner = {
      id: "p_mother",
      fullName: "Каримова Дилноза Рустамовна",
      birthDate: new Date(Date.UTC(1985, 0, 1)),
    };
    const { POST } = await import("@/app/api/crm/patients/route");
    const res = await POST(
      json("https://x/api/crm/patients", {
        fullName: "Каримов Тимур 2012",
        phone: "+998 90 123 45 67",
        phoneOwner: "other",
      }),
    );
    expect(res.status).toBe(201);
    expect(state.released).toEqual([]);
    expect(state.created[0]).toMatchObject({
      fullName: "Каримов Тимур",
      phone: "+998901234567",
      phoneNormalized: "contact:stub1",
      phoneVerifiedAt: null,
    });
    expect((state.created[0]!.birthDate as Date).getUTCFullYear()).toBe(2012);
  });

  it("a relative already registered under the number is found by name, not asked about", async () => {
    state.owner = { id: "p_mother", fullName: "Каримова Дилноза", birthDate: null };
    state.sharers = [
      { id: "p_son", fullName: "Каримов Тимур", birthDate: new Date(Date.UTC(2012, 0, 1)) },
    ];
    const { POST } = await import("@/app/api/crm/patients/route");
    const res = await POST(
      json("https://x/api/crm/patients", { fullName: "Каримов Тимур 2012", phone: "+998901234567" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "phone_already_exists", patientId: "p_son" });
  });

  it("«same» hands back the owner to book into", async () => {
    state.owner = { id: "p_mother", fullName: "Каримова Дилноза", birthDate: null };
    const { POST } = await import("@/app/api/crm/patients/route");
    const res = await POST(
      json("https://x/api/crm/patients", {
        fullName: "Каримова Д",
        phone: "+998901234567",
        phoneOwner: "same",
      }),
    );
    expect(await res.json()).toMatchObject({ reason: "phone_already_exists", patientId: "p_mother" });
  });

  it("a number only claimed in the Mini App is a question flagged unverified: nothing released, nothing created", async () => {
    state.claim = { id: "p_claim", fullName: "Юсупова Лола", birthDate: null };
    const { POST } = await import("@/app/api/crm/patients/route");
    const res = await POST(
      json("https://x/api/crm/patients", { fullName: "Юсупова Лола", phone: "+998901234567" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      reason: "phone_owner_mismatch",
      owner: { id: "p_claim", unverified: true },
    });
    expect(state.released).toEqual([]);
    expect(state.created).toEqual([]);
  });

  it("review: «same» on a claim verifies that card and books into it instead of creating a duplicate", async () => {
    state.claim = { id: "p_claim", fullName: "Yusupova Lola", birthDate: null };
    const { POST } = await import("@/app/api/crm/patients/route");
    const res = await POST(
      json("https://x/api/crm/patients", {
        fullName: "Юсупова Лола",
        phone: "+998901234567",
        phoneOwner: "same",
      }),
    );
    expect(await res.json()).toMatchObject({ reason: "phone_already_exists", patientId: "p_claim" });
    expect(state.verified).toEqual([{ id: "p_claim", via: "crm_create" }]);
    expect(state.created).toEqual([]);
  });

  it("«other» on a claim: the claim is released and a verified card created", async () => {
    state.claim = { id: "p_claim", fullName: "Юсупова Лола", birthDate: null };
    const { POST } = await import("@/app/api/crm/patients/route");
    const res = await POST(
      json("https://x/api/crm/patients", {
        fullName: "Юсупова Лола",
        phone: "+998901234567",
        phoneOwner: "other",
      }),
    );
    expect(res.status).toBe(201);
    expect(state.released).toEqual([{ phone: "+998901234567", reason: "crm_create" }]);
    expect(state.created[0]).toMatchObject({
      phoneNormalized: "+998901234567",
      phoneVerifiedAt: expect.any(Date),
    });
  });
});

describe("PATCH /api/crm/patients/[id]", () => {
  const claimCard = {
    id: "p_claim",
    clinicId: "c1",
    fullName: "Юсупова Лола",
    phone: "+998901234567",
    phoneNormalized: "+998901234567",
    phoneVerifiedAt: null,
    passport: null,
    notes: null,
  };

  function patch(body: unknown) {
    return new Request("https://x/api/crm/patients/p_claim", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("review: staff can confirm an unchanged number explicitly", async () => {
    state.before = { ...claimCard };
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    const res = await PATCH(patch({ verifyPhone: true }));
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ phoneVerifiedAt: expect.any(Date) });
    // The flag itself is not a column.
    expect(state.updates[0]).not.toHaveProperty("verifyPhone");
  });

  it("re-saving the form with the same number still verifies nothing", async () => {
    state.before = { ...claimCard };
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    await PATCH(patch({ phone: "+998901234567", fullName: "Юсупова Лола" }));
    expect(state.updates[0]).not.toHaveProperty("phoneVerifiedAt");
  });

  it("a stub (tg:, contact:) is never verified", async () => {
    state.before = { ...claimCard, phone: "", phoneNormalized: "tg:111" };
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    await PATCH(patch({ verifyPhone: true }));
    expect(state.updates[0]).not.toHaveProperty("phoneVerifiedAt");
  });
});

describe("readPhoneOwnerMismatch (dialogs)", () => {
  it("reads the owner, the claim flag included, and nothing from a plain duplicate", async () => {
    const { readPhoneOwnerMismatch } = await import(
      "@/components/appointments/phone-owner-prompt"
    );
    expect(
      readPhoneOwnerMismatch(409, {
        reason: "phone_owner_mismatch",
        owner: { id: "p_claim", fullName: "Юсупова Лола", birthYear: null, unverified: true },
      }),
    ).toEqual({ id: "p_claim", fullName: "Юсупова Лола", birthYear: null, unverified: true });
    expect(
      readPhoneOwnerMismatch(409, {
        reason: "phone_owner_mismatch",
        owner: { id: "p_mother", fullName: "Каримова Дилноза", birthYear: 1985 },
      }),
    ).toMatchObject({ id: "p_mother", unverified: false });
    // A reusable duplicate is not a question.
    expect(
      readPhoneOwnerMismatch(409, { reason: "phone_already_exists", patientId: "p_owner" }),
    ).toBeNull();
  });
});
