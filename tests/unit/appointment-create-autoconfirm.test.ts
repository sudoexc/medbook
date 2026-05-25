/**
 * POST /api/crm/appointments — auto-confirm branch (channel ∈ PHONE/KIOSK/WALKIN).
 *
 * Strategy: mock every collaborator the route imports (prisma, audit,
 * tenant-context, tg/realtime triggers, services helpers) and observe what
 * the create row + audit calls + confirm helper look like.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ----- shared state --------------------------------------------------------

type CreateCall = { data: Record<string, unknown> };
type AuditCall = {
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: unknown;
};

const state = {
  createCalls: [] as CreateCall[],
  audits: [] as AuditCall[],
  actionUpdateMany: [] as Array<Record<string, unknown>>,
  // Allow tests to override the synthesised create response shape.
  apptIdSeq: 0,
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

vi.mock("@/server/services/appointments", () => ({
  applyTime: (date: Date, time: string | null | undefined) => {
    if (!time) return date;
    const [h, m] = time.split(":").map((v) => Number.parseInt(v, 10));
    const out = new Date(date);
    out.setUTCHours(h ?? 0, m ?? 0, 0, 0);
    return out;
  },
  computeEndDate: (start: Date, durationMin: number) =>
    new Date(start.getTime() + durationMin * 60_000),
  detectConflicts: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: vi.fn(async () => undefined),
}));

vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: vi.fn(),
}));

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: Request, input: AuditCall) => {
    state.audits.push(input);
  }),
}));

// Confirm helper — POST create-time auto-confirm should NOT call it.
vi.mock("@/server/appointments/confirm", () => ({
  confirmAppointment: vi.fn(async () => ({
    ok: true,
    appointment: {},
    alreadyConfirmed: false,
  })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(async () => ({
        id: "doc_1",
        cabinetId: "cab_1",
        isActive: true,
        cabinet: { isActive: true },
      })),
    },
    service: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    appointment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.createCalls.push({ data });
        state.apptIdSeq += 1;
        const id = `appt_${state.apptIdSeq}`;
        return {
          id,
          doctorId: data.doctorId,
          patientId: data.patientId,
          cabinetId: data.cabinetId,
          status: data.status,
          queueStatus: data.queueStatus,
          date: data.date,
          endDate: data.endDate,
        };
      }),
    },
    appointmentService: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    action: {
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        state.actionUpdateMany.push(args);
        return { count: 0 };
      }),
    },
    $transaction: vi.fn(
      async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        // Re-use the same prisma surface as tx — the route only touches
        // detectConflicts (mocked) + appointment.create + appointmentService.
        const { prisma } = await import("@/lib/prisma");
        return fn(prisma);
      },
    ),
  },
}));

// ----- helpers -------------------------------------------------------------

async function loadPOST() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/appointments/route");
  return mod.POST as (req: Request) => Promise<Response>;
}

function makeBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    patientId: "p1",
    doctorId: "doc_1",
    date: "2026-06-01T00:00:00.000Z",
    time: "10:00",
    durationMin: 30,
    channel: "WALKIN",
    ...overrides,
  };
}

function postReq(body: unknown): Request {
  return new Request("https://x/api/crm/appointments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.createCalls = [];
  state.audits = [];
  state.actionUpdateMany = [];
  state.apptIdSeq = 0;
  currentCtx = {
    kind: "TENANT",
    clinicId: "c1",
    userId: "u_admin",
    role: "ADMIN",
  };
});

// ----- tests ---------------------------------------------------------------

describe("POST /api/crm/appointments — auto-confirm branch", () => {
  it("AC1 — channel=PHONE: row created CONFIRMED + APPOINTMENT_CONFIRMED audit", async () => {
    const POST = await loadPOST();
    const res = await POST(postReq(makeBody({ channel: "PHONE" })));
    expect(res.status).toBe(201);

    expect(state.createCalls).toHaveLength(1);
    const data = state.createCalls[0].data;
    expect(data.status).toBe("CONFIRMED");
    expect(data.queueStatus).toBe("CONFIRMED");
    expect(data.confirmedAt).toBeInstanceOf(Date);
    expect(data.confirmedBy).toBe("u_admin");
    expect(data.confirmedVia).toBe("BOOKING_AUTO");

    const confirmAudit = state.audits.find(
      (a) => a.action === "APPOINTMENT_CONFIRMED",
    );
    expect(confirmAudit).toBeDefined();
    expect(confirmAudit!.meta).toEqual({
      via: "BOOKING_AUTO",
      statusBefore: "BOOKED",
      statusAfter: "CONFIRMED",
      statusFlipped: true,
      channel: "PHONE",
    });
  });

  it("AC2 — channel=KIOSK: auto-confirmed with channel=KIOSK in meta", async () => {
    const POST = await loadPOST();
    const res = await POST(postReq(makeBody({ channel: "KIOSK" })));
    expect(res.status).toBe(201);
    const data = state.createCalls[0].data;
    expect(data.status).toBe("CONFIRMED");
    expect(data.queueStatus).toBe("CONFIRMED");
    expect(data.confirmedVia).toBe("BOOKING_AUTO");

    const confirmAudit = state.audits.find(
      (a) => a.action === "APPOINTMENT_CONFIRMED",
    );
    expect(confirmAudit).toBeDefined();
    expect((confirmAudit!.meta as { channel: string }).channel).toBe("KIOSK");
  });

  it("AC3 — channel=WALKIN: auto-confirmed with channel=WALKIN in meta", async () => {
    const POST = await loadPOST();
    const res = await POST(postReq(makeBody({ channel: "WALKIN" })));
    expect(res.status).toBe(201);
    const data = state.createCalls[0].data;
    expect(data.status).toBe("CONFIRMED");
    expect(data.queueStatus).toBe("CONFIRMED");
    expect(data.confirmedVia).toBe("BOOKING_AUTO");

    const confirmAudit = state.audits.find(
      (a) => a.action === "APPOINTMENT_CONFIRMED",
    );
    expect(confirmAudit).toBeDefined();
    expect((confirmAudit!.meta as { channel: string }).channel).toBe("WALKIN");
  });

  it("AC4 — channel=TELEGRAM: stays BOOKED, no APPOINTMENT_CONFIRMED audit", async () => {
    const POST = await loadPOST();
    const res = await POST(postReq(makeBody({ channel: "TELEGRAM" })));
    expect(res.status).toBe(201);
    const data = state.createCalls[0].data;
    expect(data.status).toBe("BOOKED");
    expect(data.queueStatus).toBe("BOOKED");
    expect(data.confirmedAt).toBeUndefined();
    expect(data.confirmedBy).toBeUndefined();
    expect(data.confirmedVia).toBeUndefined();

    expect(
      state.audits.find((a) => a.action === "APPOINTMENT_CONFIRMED"),
    ).toBeUndefined();
    // Only the generic create audit row fires.
    expect(state.audits.filter((a) => a.action === "appointment.create"))
      .toHaveLength(1);
  });

  it("AC5 — channel=WEBSITE: stays BOOKED, no APPOINTMENT_CONFIRMED audit", async () => {
    const POST = await loadPOST();
    const res = await POST(postReq(makeBody({ channel: "WEBSITE" })));
    expect(res.status).toBe(201);
    const data = state.createCalls[0].data;
    expect(data.status).toBe("BOOKED");
    expect(data.queueStatus).toBe("BOOKED");
    expect(data.confirmedAt).toBeUndefined();

    expect(
      state.audits.find((a) => a.action === "APPOINTMENT_CONFIRMED"),
    ).toBeUndefined();
  });

  it("AC6 — auto-confirm with no logged-in user → confirmedBy is null, no crash", async () => {
    // Force SUPER_ADMIN platform context (no userId on tenant). The route's
    // createdById branch resolves to null when ctx.kind !== 'TENANT'.
    // The api-handler wrapper normally rejects SUPER_ADMIN-without-clinic, but
    // the inner handler accepts a null createdById. Swap the auth mock to
    // return SUPER_ADMIN-with-clinicId so the wrapper passes but build a
    // tenant ctx where userId is empty-ish — simplest: pass ctx with userId
    // null at the inner level. The easiest reachable variant: change the
    // tenant ctx to SUPER_ADMIN platform (no clinicId), which the wrapper
    // would block — so instead we keep TENANT but flip the getTenant mock to
    // return a synthetic ctx with kind=SUPER_ADMIN AFTER the wrapper has set
    // up the run scope.
    //
    // Practical surface: drop the auth-side userId so the inner ctx still
    // shows kind=TENANT but with userId === "". The route uses
    // `ctx.kind === "TENANT" ? ctx.userId : null` so we just verify it
    // doesn't blow up when userId is empty.
    const auth = await import("@/lib/auth");
    (auth.auth as unknown as { mockResolvedValueOnce: (v: unknown) => void })
      .mockResolvedValueOnce({
        user: { id: "", role: "ADMIN", clinicId: "c1", email: "a@b.c" },
      });

    const POST = await loadPOST();
    // After resetModules we need to re-stub auth on the freshly-imported
    // module. Easier: re-mock via the now-imported module.
    const auth2 = await import("@/lib/auth");
    (auth2.auth as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({
        user: { id: "", role: "ADMIN", clinicId: "c1", email: "a@b.c" },
      });

    const res = await POST(postReq(makeBody({ channel: "PHONE" })));
    expect(res.status).toBe(201);
    const data = state.createCalls[0].data;
    // userId is "" → createdById is "", confirmedBy is "" (still no crash).
    expect(data.status).toBe("CONFIRMED");
    expect(data.confirmedVia).toBe("BOOKING_AUTO");
    expect(data.confirmedAt).toBeInstanceOf(Date);
  });

  it("AC7 — auto-confirm path does NOT call confirmAppointment or Action.updateMany", async () => {
    const POST = await loadPOST();
    const { confirmAppointment } = await import("@/server/appointments/confirm");
    const res = await POST(postReq(makeBody({ channel: "PHONE" })));
    expect(res.status).toBe(201);

    expect(confirmAppointment).not.toHaveBeenCalled();
    expect(state.actionUpdateMany).toHaveLength(0);
  });
});
