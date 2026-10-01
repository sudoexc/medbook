/**
 * Audit CM-08 / AC-16: the call operator can do the call center's work.
 *
 * Every target action used to answer 403 for CALL_OPERATOR: «Подтвердить»
 * (queue-status), «Записать» (POST appointments), «Создать карточку» (POST
 * patients), the «К подтверждению» list (GET actions), «Отложить» (snooze)
 * and the risk list. These drive the real routes as CALL_OPERATOR, past the
 * role gate, with the domain helpers stubbed. A nurse stays out, and the
 * operator's risk outcomes stop short of cancelling a visit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "CALL_OPERATOR" as string,
  appt: null as Record<string, unknown> | null,
  confirmCalls: [] as unknown[],
  bookCalls: [] as Array<Record<string, unknown>>,
  outcomeCalls: [] as unknown[],
  updates: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_op", role: h.role, clinicId: "c1", email: "op@example.test" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT", clinicId: "c1", userId: "u_op", role: h.role }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/appointments/confirm", () => ({
  confirmAppointment: vi.fn(async (input: unknown) => {
    h.confirmCalls.push(input);
    return { ok: true, appointment: { id: "ap_1", status: "CONFIRMED" } };
  }),
}));
vi.mock("@/server/appointments/book", () => ({
  bookAppointment: vi.fn(async (input: Record<string, unknown>) => {
    h.bookCalls.push(input);
    return { ok: true, appointment: { id: "ap_new" } };
  }),
}));
vi.mock("@/server/actions/risk-outcome", () => ({
  recordRiskOutcome: vi.fn(async (input: unknown) => {
    h.outcomeCalls.push(input);
    return { ok: false, reason: "not_found" };
  }),
}));
vi.mock("@/server/actions/list", () => ({
  visibleActionsWhere: () => ({}),
  listActionsPage: async () => ({ rows: [], nextCursor: null }),
}));
vi.mock("@/lib/prisma", () => {
  const appointment = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      h.appt && h.appt.id === where.id ? { ...h.appt, doctor: { userId: "u_doc" } } : null,
    ),
    update: vi.fn(async (args: unknown) => {
      h.updates.push(args);
      return h.appt;
    }),
    aggregate: vi.fn(async () => ({ _max: { queueOrder: 0 } })),
  };
  return {
    prisma: {
      appointment,
      action: { findUnique: vi.fn(async () => null) },
      auditLog: {
        create: vi.fn(async () => ({})),
        findMany: vi.fn(async () => []),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ appointment })),
    },
  };
});

function req(path: string, method: string, body?: unknown): Request {
  return new Request(`https://x${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  h.role = "CALL_OPERATOR";
  h.appt = {
    id: "ap_1",
    clinicId: "c1",
    doctorId: "doc_1",
    patientId: "p_1",
    status: "BOOKED",
    queueStatus: "BOOKED",
    date: new Date(Date.now() + 24 * 60 * 60_000),
    endDate: new Date(Date.now() + 24 * 60 * 60_000 + 30 * 60_000),
    startedAt: null,
    completedAt: null,
  };
  h.confirmCalls = [];
  h.bookCalls = [];
  h.outcomeCalls = [];
  h.updates = [];
});

describe("CM-08 — «Подтвердить» from the call center", () => {
  async function queueStatus(target: string) {
    const { PATCH } = await import("@/app/api/crm/appointments/[id]/queue-status/route");
    return PATCH(req("/api/crm/appointments/ap_1/queue-status", "PATCH", { queueStatus: target }));
  }

  it("the operator confirms a booking through the one confirm entry point", async () => {
    const res = await queueStatus("CONFIRMED");
    expect(res.status).toBe(200);
    expect(h.confirmCalls).toEqual([
      expect.objectContaining({ appointmentId: "ap_1", clinicId: "c1", actorId: "u_op" }),
    ]);
  });

  it("any other move by the operator is refused before the visit is touched", async () => {
    for (const target of ["WAITING", "NO_SHOW", "SKIPPED"]) {
      expect((await queueStatus(target)).status, target).toBe(403);
    }
    expect(h.updates).toEqual([]);
    expect(h.confirmCalls).toEqual([]);
  });

  it("a nurse still cannot confirm", async () => {
    h.role = "NURSE";
    expect((await queueStatus("CONFIRMED")).status).toBe(403);
    expect(h.confirmCalls).toEqual([]);
  });
});

describe("CM-08 — «Записать» and «Создать карточку»", () => {
  it("the operator books the caller with any doctor, like the desk", async () => {
    const { POST } = await import("@/app/api/crm/appointments/route");
    const res = await POST(
      req("/api/crm/appointments", "POST", {
        patientId: "p_1",
        doctorId: "doc_2",
        date: new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString(),
        channel: "PHONE",
      }),
    );
    expect(res.status).toBe(201);
    expect(h.bookCalls[0]).toMatchObject({
      doctorId: "doc_2",
      clinicId: "c1",
      createdById: "u_op",
      autoConfirm: true,
    });
  });

  it("the operator reaches the patient create (past the role gate)", async () => {
    const { POST } = await import("@/app/api/crm/patients/route");
    const res = await POST(
      req("/api/crm/patients", "POST", { fullName: "Каримова Дилноза", phone: "abcdef" }),
    );
    // The body is refused for its phone, not the caller for his role.
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("invalid_phone");
  });
});

describe("AC-16 — the Action Center for the operator", () => {
  it("the task list answers the operator, and still refuses a nurse", async () => {
    const { GET } = await import("@/app/api/crm/actions/route");
    const res = await GET(req("/api/crm/actions?type=UNCONFIRMED_24H", "GET"));
    expect(res.status).toBe(200);
    h.role = "NURSE";
    expect((await GET(req("/api/crm/actions", "GET"))).status).toBe(403);
  });

  it("«Отложить» reaches the task (404 for a missing one, not 403)", async () => {
    const { POST } = await import("@/app/api/crm/actions/[id]/snooze/route");
    const res = await POST(req("/api/crm/actions/act_1/snooze", "POST", { preset: "tomorrow" }));
    expect(res.status).toBe(404);
  });

  it("risk outcomes: «Подтвердил» goes through, «Отказался» is reception's", async () => {
    const { POST } = await import("@/app/api/crm/action-center/risk-today/outcome/route");
    const refused = await POST(
      req("/api/crm/action-center/risk-today/outcome", "POST", {
        appointmentId: "ap_1",
        outcome: "REFUSED",
        note: "передумал",
      }),
    );
    expect(refused.status).toBe(403);
    expect(JSON.stringify(await refused.json())).toContain("outcome_not_allowed");
    expect(h.outcomeCalls).toEqual([]);

    const confirmed = await POST(
      req("/api/crm/action-center/risk-today/outcome", "POST", {
        appointmentId: "ap_1",
        outcome: "CONFIRMED",
      }),
    );
    expect(confirmed.status).toBe(404); // the stubbed domain call ran
    expect(h.outcomeCalls).toHaveLength(1);
  });
});
