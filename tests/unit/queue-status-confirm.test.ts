/**
 * PATCH /api/crm/appointments/[id]/queue-status — CONFIRMED branch routes
 * through the shared `confirmAppointment` helper; everything else stays on
 * the flat-update path.
 *
 * We mock prisma + the helper + tenant-context and assert which path each
 * payload reaches plus how helper failures map onto HTTP shapes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ----- shared state --------------------------------------------------------

type Appt = {
  id: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  status: string;
  queueStatus: string;
  date: Date;
  endDate: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

const state = {
  appt: null as Appt | null,
  updateCalls: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  audits: [] as Array<{ action: string; meta: unknown }>,
  // Helper override per test
  helperResult: { ok: true, appointment: { id: "appt_1" } } as
    | { ok: true; appointment: unknown; alreadyConfirmed?: boolean }
    | { ok: false; reason: "not_found" | "cancelled" | "completed" },
  helperCalls: [] as Array<{
    appointmentId: string;
    clinicId: string;
    actorId: string | null;
    via: string;
  }>,
};

let currentCtx: unknown = {
  kind: "TENANT" as const,
  clinicId: "c1",
  userId: "u_admin",
  role: "ADMIN" as const,
};

// ----- mocks ---------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: "u_admin",
      role: "ADMIN",
      clinicId: "c1",
      email: "admin@example.test",
    },
  })),
}));

vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => currentCtx,
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: Request, input: { action: string; meta?: unknown }) => {
    state.audits.push({ action: input.action, meta: input.meta });
  }),
}));

vi.mock("@/server/appointments/confirm", () => ({
  confirmAppointment: vi.fn(async (input: {
    appointmentId: string;
    clinicId: string;
    actorId: string | null;
    via: string;
  }) => {
    state.helperCalls.push(input);
    return state.helperResult;
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (state.appt && state.appt.id === where.id) return state.appt;
        return null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          state.updateCalls.push({ where, data });
          if (!state.appt) throw new Error("no row");
          state.appt = { ...state.appt, ...(data as Partial<Appt>) };
          return state.appt;
        },
      ),
    },
    auditLog: {
      create: vi.fn(async () => ({ id: "a1" })),
    },
  },
}));

// ----- helpers -------------------------------------------------------------

async function loadPATCH() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/appointments/[id]/queue-status/route");
  return mod.PATCH as (req: Request) => Promise<Response>;
}

function patchReq(id: string, body: unknown): Request {
  return new Request(
    `https://x/api/crm/appointments/${id}/queue-status`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makeAppt(overrides: Partial<Appt> = {}): Appt {
  const start = new Date("2026-06-01T10:00:00.000Z");
  return {
    id: "appt_1",
    clinicId: "c1",
    doctorId: "doc_1",
    patientId: "p1",
    status: "BOOKED",
    queueStatus: "BOOKED",
    date: start,
    endDate: new Date(start.getTime() + 30 * 60_000),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.appt = makeAppt();
  state.updateCalls = [];
  state.audits = [];
  state.helperCalls = [];
  state.helperResult = {
    ok: true,
    appointment: { id: "appt_1", queueStatus: "CONFIRMED", status: "CONFIRMED" },
  };
  currentCtx = {
    kind: "TENANT",
    clinicId: "c1",
    userId: "u_admin",
    role: "ADMIN",
  };
});

// ----- tests ---------------------------------------------------------------

describe("PATCH queue-status — CONFIRMED branch", () => {
  it("QS1 — queueStatus=CONFIRMED routes through confirmAppointment helper", async () => {
    const PATCH = await loadPATCH();
    const res = await PATCH(patchReq("appt_1", { queueStatus: "CONFIRMED" }));
    expect(res.status).toBe(200);

    expect(state.helperCalls).toHaveLength(1);
    expect(state.helperCalls[0]).toEqual({
      appointmentId: "appt_1",
      clinicId: "c1",
      actorId: "u_admin",
      via: "MANUAL_CRM",
    });

    // The flat-update path is NOT taken when CONFIRMED goes through helper.
    expect(state.updateCalls).toHaveLength(0);

    const body = await res.json();
    expect(body.id).toBe("appt_1");
    expect(body.queueStatus).toBe("CONFIRMED");
  });

  it("QS2 — queueStatus=WAITING uses the flat-update path, no confirm helper", async () => {
    const PATCH = await loadPATCH();
    const { confirmAppointment } = await import("@/server/appointments/confirm");
    const res = await PATCH(patchReq("appt_1", { queueStatus: "WAITING" }));
    expect(res.status).toBe(200);

    expect(confirmAppointment).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(1);
    const data = state.updateCalls[0].data;
    expect(data.queueStatus).toBe("WAITING");
    expect(data.status).toBe("WAITING");
    expect(data.confirmedAt).toBeUndefined();
    expect(data.confirmedBy).toBeUndefined();
    expect(data.confirmedVia).toBeUndefined();
  });

  it("QS3 — helper returns not_found → 404", async () => {
    state.helperResult = { ok: false, reason: "not_found" };
    const PATCH = await loadPATCH();
    const res = await PATCH(patchReq("appt_1", { queueStatus: "CONFIRMED" }));
    expect(res.status).toBe(404);
  });

  it("QS4 — helper returns cancelled → 409 conflict (reason='cancelled')", async () => {
    // BUG-WATCH: the route calls `conflict("invalid_transition", { reason:
    // result.reason })`. `conflict()` spreads `extra` AFTER setting `reason`,
    // so `extra.reason` ("cancelled") overrides the canonical
    // "invalid_transition" — the response carries `reason: "cancelled"` and
    // there's no `to: "CONFIRMED"` shape because `from` survives but the
    // canonical reason is lost. UI code keying off `reason ===
    // "invalid_transition"` would not match. Flagged for review; the test
    // pins the CURRENT shape so a future intentional fix breaks this assert.
    state.helperResult = { ok: false, reason: "cancelled" };
    const PATCH = await loadPATCH();
    const res = await PATCH(patchReq("appt_1", { queueStatus: "CONFIRMED" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe("conflict");
    // Current shape — see BUG-WATCH above.
    expect(body.reason).toBe("cancelled");
  });

  it("QS5 — invalid transition guard runs BEFORE helper call (COMPLETED → CONFIRMED)", async () => {
    state.appt = makeAppt({ queueStatus: "COMPLETED", status: "COMPLETED" });
    const PATCH = await loadPATCH();
    const { confirmAppointment } = await import("@/server/appointments/confirm");
    const res = await PATCH(patchReq("appt_1", { queueStatus: "CONFIRMED" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe("conflict");
    expect(body.reason).toBe("invalid_transition");

    expect(confirmAppointment).not.toHaveBeenCalled();
  });

  it("QS6 — tenant ctx without clinicId → 400 ClinicNotSelected", async () => {
    // The route's `tenant?.kind === 'TENANT' ? tenant.clinicId : null` branch
    // returns null if the ctx isn't TENANT-shaped. Flip the getTenant mock to
    // hand back a SUPER_ADMIN platform ctx for this single call. (The outer
    // wrapper would normally reject this upstream; we exercise the inner
    // safety net.)
    currentCtx = { kind: "SUPER_ADMIN", userId: "u_admin" };
    const PATCH = await loadPATCH();
    const { confirmAppointment } = await import("@/server/appointments/confirm");

    // After loadPATCH() re-imports, our currentCtx variable still controls
    // getTenant. Re-set just to be safe.
    currentCtx = { kind: "SUPER_ADMIN", userId: "u_admin" };

    const res = await PATCH(patchReq("appt_1", { queueStatus: "CONFIRMED" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ClinicNotSelected");
    expect(confirmAppointment).not.toHaveBeenCalled();
  });
});
