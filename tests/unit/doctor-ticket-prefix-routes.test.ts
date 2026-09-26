/**
 * Audit Q-12: a doctor's ticket letter is assigned on create and editable by
 * the admin, unique within the clinic.
 *
 *   POST  /api/crm/doctors       → the clinic's next free letter (or the
 *                                  admin's pick);
 *   PATCH /api/crm/doctors/[id]  → admin sets a letter; a letter another
 *                                  doctor holds answers 409, a doctor editing
 *                                  their own profile cannot change it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "DOCTOR",
  /** Letters already held in clinic c1 (read through the Clinic row). */
  taken: [] as Array<{ id: string; ticketPrefix: string }>,
  created: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  before: null as Record<string, unknown> | null,
  updateError: null as unknown,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: state.role === "ADMIN" ? "u_admin" : "u_doc",
      role: state.role,
      clinicId: "c1",
      email: "x@x.t",
    },
  })),
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_admin",
    role: "ADMIN" as const,
  }),
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

vi.mock("@/server/branches/resolve-branch", () => ({
  resolveEffectiveBranchId: vi.fn(async () => null),
}));

vi.mock("@/server/doctors/deactivation", () => ({
  countDoctorDeleteBlockers: vi.fn(),
  countStrandedAppointments: vi.fn(async () => 0),
  findServicesOrphanedByDeactivating: vi.fn(async () => []),
}));

vi.mock("@/lib/prisma", () => {
  const clinic = {
    findUnique: vi.fn(async () => ({ doctors: state.taken })),
  };
  const doctor = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.created.push(data);
      return { id: "d_new", clinicId: "c1", ...data };
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (state.updateError) throw state.updateError;
      state.updates.push(data);
      return { ...state.before, ...data };
    }),
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      // Cabinet occupancy check on create: the cabinet is free.
      if ("cabinetId" in where) return null;
      return state.before;
    }),
  };
  const tx = {
    clinic,
    doctor,
    serviceOnDoctor: {
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return {
    prisma: {
      ...tx,
      cabinet: {
        findUnique: vi.fn(async () => ({ id: "cab_9", isActive: true })),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});

function req(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const NEW_DOCTOR = {
  slug: "new-doc",
  nameRu: "Новый Врач",
  nameUz: "Yangi Shifokor",
  specializationRu: "Невролог",
  specializationUz: "Nevrolog",
  cabinetId: "cab_9",
};

beforeEach(() => {
  state.role = "ADMIN";
  state.taken = [];
  state.created = [];
  state.updates = [];
  state.updateError = null;
  state.before = {
    id: "d3",
    clinicId: "c1",
    userId: "u_doc",
    isActive: true,
    cabinetId: "cab_3",
    ticketPrefix: "C",
  };
});

describe("POST /api/crm/doctors assigns a ticket letter", () => {
  it("gives a new doctor the clinic's next free letter", async () => {
    state.taken = [
      { id: "d1", ticketPrefix: "A" },
      { id: "d2", ticketPrefix: "B" },
    ];
    const { POST } = await import("@/app/api/crm/doctors/route");
    const res = await POST(req("https://x/api/crm/doctors", "POST", NEW_DOCTOR));
    expect(res.status).toBe(201);
    expect(state.created[0].ticketPrefix).toBe("C");
  });

  it("keeps the admin's own pick, normalised", async () => {
    const { POST } = await import("@/app/api/crm/doctors/route");
    const res = await POST(
      req("https://x/api/crm/doctors", "POST", { ...NEW_DOCTOR, ticketPrefix: " k " }),
    );
    expect(res.status).toBe(201);
    expect(state.created[0].ticketPrefix).toBe("K");
  });
});

describe("PATCH /api/crm/doctors/[id] edits the ticket letter", () => {
  it("saves a free letter", async () => {
    state.taken = [
      { id: "d1", ticketPrefix: "A" },
      { id: "d3", ticketPrefix: "C" },
    ];
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await PATCH(
      req("https://x/api/crm/doctors/d3", "PATCH", { ticketPrefix: "n" }),
    );
    expect(res.status).toBe(200);
    expect(state.updates[0].ticketPrefix).toBe("N");
  });

  it("refuses a letter another doctor of the clinic holds", async () => {
    state.taken = [
      { id: "d1", ticketPrefix: "A" },
      { id: "d3", ticketPrefix: "C" },
    ];
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await PATCH(
      req("https://x/api/crm/doctors/d3", "PATCH", { ticketPrefix: "a" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      reason: "ticket_prefix_taken",
      doctorId: "d1",
    });
    expect(state.updates).toHaveLength(0);
  });

  it("answers 409 when the unique index catches a race", async () => {
    state.updateError = Object.assign(
      new Error("Unique constraint failed on the fields: (`clinicId`,`ticketPrefix`)"),
      { code: "P2002" },
    );
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await PATCH(
      req("https://x/api/crm/doctors/d3", "PATCH", { ticketPrefix: "Q" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "ticket_prefix_taken" });
  });

  it("refuses something that is not one or two Latin letters", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await PATCH(
      req("https://x/api/crm/doctors/d3", "PATCH", { ticketPrefix: "7" }),
    );
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("a doctor editing their own profile cannot move their letter", async () => {
    state.role = "DOCTOR";
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await PATCH(
      req("https://x/api/crm/doctors/d3", "PATCH", {
        ticketPrefix: "Z",
        bioRu: "Опыт 10 лет",
      }),
    );
    expect(res.status).toBe(200);
    expect(state.updates[0]).not.toHaveProperty("ticketPrefix");
    expect(state.updates[0].bioRu).toBe("Опыт 10 лет");
  });
});
