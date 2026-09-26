/**
 * Audit Q-05 / AP-12 (server side) and the queue-status half of Q-14.
 *
 * Reception browsing tomorrow on the doctors panel pressed «Пришёл»: the
 * booking took one of TODAY's ticket numbers (C-017, so tomorrow's counter
 * started at C-018), got a false arrival stamp and hung in WAITING forever,
 * since the no-show sweep never touches WAITING. «Начать запись» there sent
 * a patient at home «📢 Вас вызывают! Кабинет 5» and started a visit on the
 * doctor's screen. The public check-in had a `not_today` guard; the CRM
 * paths had none.
 *
 * Acceptance: PATCH queue-status WAITING / IN_PROGRESS for tomorrow's booking
 * answers 409 `not_today` and writes nothing; the generic PATCH, the doctor's
 * call and bulk-status refuse the same way; today's booking still arrives.
 * And (Q-14) a row whose `status` is terminal is not revived through a
 * drifted `queueStatus`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  role: "RECEPTIONIST" as "RECEPTIONIST" | "DOCTOR",
  aggregate: vi.fn(async () => ({ _max: { queueOrder: 4, ticketSeq: 4 } })),
  sendCallNotice: vi.fn(async () => true),
  updates: [] as Array<{ id: string; data: Row }>,
}));

const state = { appts: new Map<string, Row>() };

const DAY = 24 * 60 * 60_000;

function appt(id: string, over: Row = {}): Row {
  const start = new Date();
  return {
    id,
    clinicId: "c1",
    patientId: `p_${id}`,
    doctorId: "doc_1",
    cabinetId: null,
    channel: "PHONE",
    status: "CONFIRMED",
    queueStatus: "CONFIRMED",
    date: start,
    endDate: new Date(start.getTime() + 30 * 60_000),
    time: null,
    durationMin: 30,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    queueOrder: null,
    ticketSeq: null,
    queuedAt: null,
    priceBase: null,
    discountPct: 0,
    discountAmount: 0,
    medicalCaseId: null,
    serviceId: null,
    ...over,
  };
}

/** The same slot one clinic day ahead. */
function tomorrow(id: string, over: Row = {}): Row {
  const start = new Date(Date.now() + DAY);
  return appt(id, {
    date: start,
    endDate: new Date(start.getTime() + 30 * 60_000),
    ...over,
  });
}

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: h.role === "DOCTOR" ? "u_doc" : "u_recept",
      role: h.role,
      clinicId: "c1",
      email: "x@example.test",
    },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: h.role === "DOCTOR" ? "u_doc" : "u_recept",
    role: h.role,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/appointments/emit-change", () => ({
  emitAppointmentChangeViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/server/telegram/call-notice", () => ({
  sendCallNotice: h.sendCallNotice,
}));
vi.mock("@/server/telegram/send", () => ({
  sendMessage: vi.fn(async () => undefined),
}));
vi.mock("@/server/visit-notes/unsigned-draft", () => ({
  findUnsignedDraft: vi.fn(async () => null),
}));
vi.mock("@/server/appointments/completion-effects", () => ({
  runCompletionEffects: vi.fn(async () => undefined),
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: vi.fn(async () => undefined),
}));
vi.mock("@/server/appointments/active-visit", () => ({
  AnotherVisitInProgressError: class AnotherVisitInProgressError extends Error {},
  orActiveVisitConflict: <T,>(run: Promise<T>) => run,
  runStartVisitTx: vi.fn(
    async (_params: unknown, write: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import("@/lib/prisma");
      return prisma.$transaction(write as never);
    },
  ),
}));
vi.mock("@/lib/prisma", () => {
  const appointment = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const row = state.appts.get(where.id);
      return row ? { ...row, doctor: { userId: "u_doc" } } : null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) =>
      state.appts.get(where.id),
    ),
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => state.appts.get(id)).filter(Boolean),
    ),
    aggregate: h.aggregate,
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      h.updates.push({ id: where.id, data });
      const next = { ...state.appts.get(where.id), ...data };
      state.appts.set(where.id, next);
      return {
        ...next,
        patient: { fullName: "Каримов Азиз", telegramId: "tg1", preferredLang: "RU" },
        doctor: { nameRu: "Султанов А.", ticketPrefix: "A", cabinet: { number: "5" } },
        clinic: { id: "c1", slug: "neurofax", tgBotToken: "t", tgBotUsername: "b" },
      };
    }),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  const prisma = {
    appointment,
    auditLog: { create: vi.fn(async () => ({ id: "al" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  };
  return { prisma };
});

function json(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function queueStatus(id: string, target: string): Promise<Response> {
  vi.resetModules();
  const { PATCH } = await import(
    "@/app/api/crm/appointments/[id]/queue-status/route"
  );
  return PATCH(
    json(`https://x/api/crm/appointments/${id}/queue-status`, "PATCH", {
      queueStatus: target,
    }),
  );
}

beforeEach(() => {
  h.role = "RECEPTIONIST";
  h.aggregate.mockClear();
  h.sendCallNotice.mockClear();
  h.updates = [];
  state.appts = new Map();
});

describe("Q-05: queue-status refuses arrival and the call on another day", () => {
  it("«Пришёл» on tomorrow's booking: 409 not_today, no ticket number burned", async () => {
    state.appts.set("t1", tomorrow("t1"));

    const res = await queueStatus("t1", "WAITING");

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("not_today");
    expect(h.aggregate).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
    expect(state.appts.get("t1")).toMatchObject({
      queueStatus: "CONFIRMED",
      queueOrder: null,
      queuedAt: null,
    });
  });

  it("«Начать запись» on tomorrow's booking: 409 not_today, nobody is called", async () => {
    state.appts.set("t1", tomorrow("t1"));

    const res = await queueStatus("t1", "IN_PROGRESS");

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("not_today");
    expect(h.sendCallNotice).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("yesterday's leftover booking cannot arrive today either", async () => {
    const start = new Date(Date.now() - DAY);
    state.appts.set(
      "y1",
      appt("y1", { date: start, endDate: new Date(start.getTime() + 30 * 60_000) }),
    );

    const res = await queueStatus("y1", "WAITING");

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("not_today");
  });

  it("today's booking still arrives and takes today's number", async () => {
    state.appts.set("a1", appt("a1"));

    const res = await queueStatus("a1", "WAITING");

    expect(res.status).toBe(200);
    expect(h.aggregate).toHaveBeenCalled();
    expect(state.appts.get("a1")).toMatchObject({
      status: "WAITING",
      queueStatus: "WAITING",
      queueOrder: 5,
    });
  });

  it("a visit already on the table may be re-issued IN_PROGRESS (no day change involved)", async () => {
    const start = new Date(Date.now() - DAY);
    state.appts.set(
      "ip",
      appt("ip", {
        date: start,
        endDate: new Date(start.getTime() + 30 * 60_000),
        status: "IN_PROGRESS",
        queueStatus: "IN_PROGRESS",
        startedAt: start,
      }),
    );
    const res = await queueStatus("ip", "IN_PROGRESS");
    expect(res.status).toBe(200);
  });

  it("closing a visit is not day-bound (yesterday's leftover can be completed)", async () => {
    const start = new Date(Date.now() - DAY);
    state.appts.set(
      "ip",
      appt("ip", {
        date: start,
        endDate: new Date(start.getTime() + 30 * 60_000),
        status: "IN_PROGRESS",
        queueStatus: "IN_PROGRESS",
        startedAt: start,
      }),
    );
    const res = await queueStatus("ip", "COMPLETED");
    expect(res.status).toBe(200);
  });
});

describe("Q-14: queue-status does not revive a terminal status", () => {
  it("an auto no-show still reading CONFIRMED in the queue column cannot arrive", async () => {
    state.appts.set(
      "ns",
      appt("ns", { status: "NO_SHOW", queueStatus: "CONFIRMED" }),
    );

    const res = await queueStatus("ns", "WAITING");

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("invalid_transition");
    expect(h.updates).toEqual([]);
  });

  it("a completed visit with a drifted queue column cannot be restarted", async () => {
    state.appts.set(
      "cm",
      appt("cm", { status: "COMPLETED", queueStatus: "IN_PROGRESS" }),
    );
    const res = await queueStatus("cm", "WAITING");
    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("invalid_transition");
  });
});

describe("Q-05: the other CRM paths refuse the same way", () => {
  it("generic PATCH status WAITING for tomorrow: 409 not_today", async () => {
    state.appts.set("t1", tomorrow("t1"));
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/appointments/[id]/route");

    const res = await PATCH(
      json("https://x/api/crm/appointments/t1", "PATCH", { status: "WAITING" }),
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("not_today");
    expect(h.updates).toEqual([]);
  });

  it("generic PATCH with a raw queueStatus IN_PROGRESS for tomorrow: 409 not_today", async () => {
    state.appts.set("t1", tomorrow("t1"));
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/appointments/[id]/route");

    const res = await PATCH(
      json("https://x/api/crm/appointments/t1", "PATCH", {
        queueStatus: "IN_PROGRESS",
      }),
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("not_today");
  });

  it("the doctor's «Вызвать» on tomorrow's visit: 409 not_today, no push", async () => {
    h.role = "DOCTOR";
    state.appts.set("t1", tomorrow("t1"));
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/appointments/[id]/route");

    const res = await PATCH(
      json("https://x/api/crm/appointments/t1?call=true", "PATCH", {}),
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("not_today");
    expect(h.updates).toEqual([]);
  });

  it("bulk «Пришёл» over a list holding tomorrow's booking: whole batch refused", async () => {
    state.appts.set("a1", appt("a1"));
    state.appts.set("t1", tomorrow("t1"));
    vi.resetModules();
    const { POST } = await import(
      "@/app/api/crm/appointments/bulk-status/route"
    );

    const res = await POST(
      json("https://x/api/crm/appointments/bulk-status", "POST", {
        ids: ["a1", "t1"],
        status: "WAITING",
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as Row;
    expect(body.reason).toBe("not_today");
    expect(body.blocked).toEqual([{ id: "t1", from: "CONFIRMED" }]);
    expect(h.aggregate).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });
});
