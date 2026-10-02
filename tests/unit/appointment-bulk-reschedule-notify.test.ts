/**
 * POST /api/crm/appointments/bulk-reschedule — a batch move must not be silent.
 *
 * The route used to shift `date`/`endDate`/`time` inside one transaction and
 * stop there: no realtime envelope and no notification trigger. So a batch
 * move was invisible everywhere it mattered — a patient with the Mini App open
 * kept seeing the old slot, and the reminder cascade (materialised at booking
 * time with the old wall clock baked into the body) kept counting down to a
 * slot that no longer existed.
 *
 * These tests pin the contract that a bulk move takes the same path as the
 * single-appointment PATCH: an `appointment.moved` envelope per row, and an
 * `appointment.rescheduled` trigger per row so the stale reminders are
 * cancelled and the cascade is rebuilt around the new start.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Appointment = {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  cabinetId: string | null;
  date: Date;
  endDate: Date;
  time: string | null;
  status: string;
  queueStatus: string;
  channel: string;
  medicalCaseId?: string | null;
  queuedAt?: Date | null;
};

const state = {
  rows: [] as Appointment[],
  updates: [] as Array<{ id: string; date: Date; time: string | null }>,
  /** The full `data` of every row update (AP-16 un-arrive). */
  updateData: [] as Array<{ id: string; data: Record<string, unknown> }>,
  emitted: [] as Array<{ kind: string; appointmentId: string; alsoQueueUpdate?: boolean }>,
  repriced: [] as string[],
  fired: [] as Array<{ kind: string; appointmentId: string }>,
  audits: [] as Array<{ action: string }>,
  /** The visits' risk tasks, one open, one a callback promised on the phone. */
  actions: [] as Array<Record<string, unknown>>,
  actionWrites: 0,
};

/** 2026-09-12 11:00 Tashkent (UTC+5) → 06:00Z. */
const BASE = new Date("2026-09-12T06:00:00.000Z");

function makeAppt(id: string, offsetMin = 0): Appointment {
  const start = new Date(BASE.getTime() + offsetMin * 60_000);
  return {
    id,
    clinicId: "c1",
    patientId: `p_${id}`,
    doctorId: "doc_1",
    cabinetId: "cab_1",
    date: start,
    endDate: new Date(start.getTime() + 30 * 60_000),
    time: "11:00",
    status: "BOOKED",
    queueStatus: "BOOKED",
    channel: "WEBSITE",
  };
}

// ----- module mocks --------------------------------------------------------

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

vi.mock("@/server/services/appointments", () => ({
  detectConflicts: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/appointment-transitions", () => ({
  actionsFor: () => ({ canReschedule: true }),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: unknown, entry: { action: string }) => {
    state.audits.push(entry);
  }),
}));

vi.mock("@/server/appointments/emit-change", () => ({
  emitAppointmentChangeViaOutbox: vi.fn(
    async (input: { kind: string; after: { id: string }; alsoQueueUpdate?: boolean }) => {
      state.emitted.push({
        kind: input.kind,
        appointmentId: input.after.id,
        alsoQueueUpdate: input.alsoQueueUpdate,
      });
      return { eventId: "ev_1" };
    },
  ),
}));

vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_1",
  publishViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
}));

vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: vi.fn((p: { kind: string; appointmentId: string }) => {
    state.fired.push(p);
  }),
}));

vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeCaseAppointments: vi.fn(async (_tx: unknown, caseId: string) => {
    state.repriced.push(caseId);
    return [];
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async () => state.rows),
      findFirst: vi.fn(async () => null),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { date: Date; endDate: Date; time: string | null };
        }) => {
          const row = state.rows.find((r) => r.id === where.id)!;
          const merged = { ...row, ...data };
          state.updateData.push({ id: where.id, data });
          state.updates.push({
            id: where.id,
            date: data.date,
            time: data.time,
          });
          return merged;
        },
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.rows.find((r) => r.id === where.id)!,
      ),
    },
    action: {
      findMany: vi.fn(async () => state.actions),
      update: vi.fn(async () => {
        state.actionWrites++;
        return {};
      }),
      updateMany: vi.fn(async () => {
        state.actionWrites++;
        return { count: 0 };
      }),
    },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const { prisma } = await import("@/lib/prisma");
      return fn(prisma);
    }),
  },
}));

// ----- helpers -------------------------------------------------------------

async function loadPost() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/appointments/bulk-reschedule/route");
  return mod.POST;
}

function req(body: unknown): Request {
  return new Request("https://x/api/crm/appointments/bulk-reschedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.rows = [makeAppt("apt_1"), makeAppt("apt_2", 60)];
  state.updates = [];
  state.updateData = [];
  state.repriced = [];
  state.emitted = [];
  state.fired = [];
  state.audits = [];
  state.actions = [
    {
      id: "act_u",
      type: "UNCONFIRMED_24H",
      status: "OPEN",
      outcome: null,
      dedupeKey: "UNCONFIRMED_24H:appointmentId=apt_1",
    },
    {
      id: "act_cb",
      type: "NO_SHOW_RISK_HIGH",
      status: "SNOOZED",
      outcome: "CALLBACK",
      dedupeKey: "NO_SHOW_RISK_HIGH:appointmentId=apt_2",
    },
  ];
  state.actionWrites = 0;
});

// ----- tests ---------------------------------------------------------------

describe("bulk-reschedule", () => {
  it("emits appointment.moved for every row it shifts", async () => {
    const POST = await loadPost();

    const res = await POST(
      req({ ids: ["apt_1", "apt_2"], deltaMinutes: 30 }),
    );
    expect(res.status).toBe(200);

    expect(state.emitted).toHaveLength(2);
    expect(state.emitted.every((e) => e.kind === "moved")).toBe(true);
    expect(state.emitted.map((e) => e.appointmentId).sort()).toEqual([
      "apt_1",
      "apt_2",
    ]);
  });

  it("fires appointment.rescheduled per row so reminders are rebuilt", async () => {
    const POST = await loadPost();

    await POST(req({ ids: ["apt_1", "apt_2"], deltaMinutes: 30 }));

    expect(state.fired).toHaveLength(2);
    expect(state.fired.every((f) => f.kind === "appointment.rescheduled")).toBe(
      true,
    );
    expect(state.fired.map((f) => f.appointmentId).sort()).toEqual([
      "apt_1",
      "apt_2",
    ]);
  });

  it("shifts the start by the delta and keeps the Tashkent wall clock in sync", async () => {
    const POST = await loadPost();

    await POST(req({ ids: ["apt_1"], deltaMinutes: 30 }));

    const upd = state.updates.find((u) => u.id === "apt_1")!;
    expect(upd.date.getTime()).toBe(BASE.getTime() + 30 * 60_000);
    // 11:00 Tashkent + 30m — the display column must not drift (prod runs UTC).
    expect(upd.time).toBe("11:30");
  });

  it("stays silent when the batch is refused", async () => {
    state.rows = [];
    const POST = await loadPost();

    const res = await POST(req({ ids: ["apt_missing"], deltaMinutes: 30 }));

    expect(res.status).toBe(409);
    expect(state.updates).toEqual([]);
    expect(state.emitted).toEqual([]);
    expect(state.fired).toEqual([]);
  });
});

// Audit AC-10 review: the shift used to stamp every visit's open risk task
// as «Перенести», with the mover as the one who handled it, although nobody
// called anyone; a callback promised on the phone was overwritten too.
describe("bulk-reschedule and the risk tasks", () => {
  it("records no call outcome and leaves every task as it was", async () => {
    const POST = await loadPost();
    const res = await POST(req({ ids: ["apt_1", "apt_2"], deltaMinutes: 30 }));
    expect(res.status).toBe(200);
    expect(state.actionWrites).toBe(0);
    expect(state.audits.map((a) => a.action)).not.toContain("ACTION_OUTCOME");
  });
});

// Audit AP-16: the bulk shift wrote only the times. A patient already in the
// hall (WAITING) moved to tomorrow stayed WAITING with today's queuedAt, and
// a case whose first visit moved kept yesterday's free-repeat prices.
describe("bulk-reschedule takes the single PATCH's side effects (AP-16)", () => {
  it("un-arrives a WAITING row moved to another day and tells the boards", async () => {
    state.rows = [
      {
        ...makeAppt("apt_w"),
        status: "WAITING",
        queueStatus: "WAITING",
        queuedAt: new Date(BASE.getTime() - 10 * 60_000),
      },
    ];
    const POST = await loadPost();
    const res = await POST(req({ ids: ["apt_w"], deltaMinutes: 24 * 60 }));
    expect(res.status).toBe(200);
    expect(state.updateData[0]!.data).toMatchObject({
      status: "CONFIRMED",
      queueStatus: "CONFIRMED",
      queuedAt: null,
    });
    expect(state.emitted[0]!.alsoQueueUpdate).toBe(true);
  });

  it("keeps the arrival of a WAITING row moved within the same day", async () => {
    state.rows = [{ ...makeAppt("apt_w"), status: "WAITING", queueStatus: "WAITING" }];
    const POST = await loadPost();
    await POST(req({ ids: ["apt_w"], deltaMinutes: 30 }));
    expect(state.updateData[0]!.data).not.toHaveProperty("status");
    expect(state.updateData[0]!.data).not.toHaveProperty("queuedAt");
    expect(state.emitted[0]!.alsoQueueUpdate).toBe(false);
  });

  it("leaves a booking's status alone on a day move", async () => {
    const POST = await loadPost();
    await POST(req({ ids: ["apt_1"], deltaMinutes: 24 * 60 }));
    expect(state.updateData[0]!.data).not.toHaveProperty("status");
  });

  it("reprices every case a moved row belongs to, once each", async () => {
    state.rows = [
      { ...makeAppt("apt_1"), medicalCaseId: "case_a" },
      { ...makeAppt("apt_2", 60), medicalCaseId: "case_a" },
      { ...makeAppt("apt_3", 120), medicalCaseId: "case_b" },
      makeAppt("apt_4", 180),
    ];
    const POST = await loadPost();
    const res = await POST(
      req({ ids: ["apt_1", "apt_2", "apt_3", "apt_4"], deltaMinutes: 24 * 60 }),
    );
    expect(res.status).toBe(200);
    expect(state.repriced.sort()).toEqual(["case_a", "case_b"]);
  });

  it("reprices nothing when no moved row is in a case", async () => {
    const POST = await loadPost();
    await POST(req({ ids: ["apt_1", "apt_2"], deltaMinutes: 30 }));
    expect(state.repriced).toEqual([]);
  });
});
