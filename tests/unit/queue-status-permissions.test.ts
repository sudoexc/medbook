/**
 * Audit Q-04: who may drive PATCH /api/crm/appointments/[id]/queue-status,
 * and when «Не пришёл» may be set.
 *
 * The route let a NURSE (read-only by the permission matrix) flip visits to
 * «Не пришёл» or «Пропущен», let doctor A call doctor B's patients (B's TV
 * rang and the patient got «Вас вызывают»), and took `canTransition`
 * without the time rules: a booking two hours ahead could be marked a
 * no-show on the spot, and the no-show notice never went out from here.
 *
 * Acceptance: NURSE → 403; a doctor on another doctor's visit → 403; NO_SHOW
 * for a visit two hours ahead → 409 too_early_for_no_show; after the slot
 * the no-show lands and fires the same trigger as the generic PATCH. The P2
 * exception stays: «Пришёл» after the sweep's own no-show still checks in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Role = "RECEPTIONIST" | "DOCTOR" | "NURSE" | "ADMIN";

const h = vi.hoisted(() => ({
  role: "RECEPTIONIST" as "RECEPTIONIST" | "DOCTOR" | "NURSE" | "ADMIN",
  userId: "u_recept",
  fireTrigger: vi.fn(),
  sendCallNotice: vi.fn(async () => true),
  aggregate: vi.fn(async () => ({ _max: { queueOrder: 4, ticketSeq: 4 } })),
  auditRows: [] as Array<{ entityId: string; action: string; createdAt: Date }>,
  updates: [] as Array<{ id: string; data: Row }>,
}));

const state = { appts: new Map<string, Row>() };

// Mon 28.09.2026 11:00 in Tashkent.
const NOW = new Date("2026-09-28T06:00:00.000Z");
const MIN = 60_000;

function appt(id: string, over: Row = {}): Row {
  const start = (over.date as Date | undefined) ?? new Date(NOW.getTime() - 30 * MIN);
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
    endDate: new Date(start.getTime() + 30 * MIN),
    time: null,
    durationMin: 30,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    queueOrder: null,
    ticketSeq: null,
    queuedAt: null,
    medicalCaseId: null,
    // Owner of the visit: doctor A.
    doctorUserId: "u_doc_a",
    ...over,
  };
}

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: h.userId, role: h.role, clinicId: "c1", email: "x@example.test" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: h.userId,
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
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: h.fireTrigger }));
vi.mock("@/server/telegram/call-notice", () => ({ sendCallNotice: h.sendCallNotice }));
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
      return row ? { ...row, doctor: { userId: row.doctorUserId } } : null;
    }),
    aggregate: h.aggregate,
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
      ...state.appts.get(where.id),
      patient: { fullName: "Каримова Дилноза", telegramId: null, preferredLang: "UZ" },
      doctor: { nameRu: "Султанов А.", ticketPrefix: "A", cabinet: { number: "5" } },
      clinic: { id: "c1", slug: "neurofax", tgBotToken: null, tgBotUsername: null },
    })),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      h.updates.push({ id: where.id, data });
      const next = { ...state.appts.get(where.id), ...data };
      state.appts.set(where.id, next);
      return {
        ...next,
        patient: { fullName: "Каримова Дилноза", telegramId: null, preferredLang: "UZ" },
        doctor: { nameRu: "Султанов А.", ticketPrefix: "A", cabinet: { number: "5" } },
        clinic: { id: "c1", slug: "neurofax", tgBotToken: null, tgBotUsername: null },
      };
    }),
  };
  const prisma = {
    appointment,
    auditLog: {
      create: vi.fn(async () => ({ id: "al" })),
      findMany: vi.fn(
        async ({ where }: { where: { entityId: { in: string[] }; action: { in: string[] } } }) =>
          h.auditRows.filter(
            (r) => where.entityId.in.includes(r.entityId) && where.action.in.includes(r.action),
          ),
      ),
    },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  };
  return { prisma };
});

async function queueStatus(id: string, target: string): Promise<Response> {
  const { PATCH } = await import("@/app/api/crm/appointments/[id]/queue-status/route");
  return PATCH(
    new Request(`https://x/api/crm/appointments/${id}/queue-status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queueStatus: target }),
    }),
  );
}

function as(role: Role, userId: string) {
  h.role = role;
  h.userId = userId;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  as("RECEPTIONIST", "u_recept");
  h.fireTrigger.mockClear();
  h.sendCallNotice.mockClear();
  h.aggregate.mockClear();
  h.auditRows = [];
  h.updates = [];
  state.appts = new Map();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Q-04 — queue-status permissions", () => {
  it("a NURSE is refused (403) and nothing is written", async () => {
    as("NURSE", "u_nurse");
    state.appts.set("a1", appt("a1"));
    for (const target of ["NO_SHOW", "SKIPPED", "WAITING"]) {
      const res = await queueStatus("a1", target);
      expect(res.status, target).toBe(403);
    }
    expect(h.updates).toEqual([]);
  });

  it("a doctor calling another doctor's patient is refused (403): no TV call, no push", async () => {
    as("DOCTOR", "u_doc_b");
    state.appts.set("a1", appt("a1", { status: "WAITING", queueStatus: "WAITING" }));
    const res = await queueStatus("a1", "IN_PROGRESS");
    expect(res.status).toBe(403);
    expect(h.updates).toEqual([]);
    expect(h.sendCallNotice).not.toHaveBeenCalled();
  });

  it("the doctor drives his own queue", async () => {
    as("DOCTOR", "u_doc_a");
    state.appts.set("a1", appt("a1", { status: "WAITING", queueStatus: "WAITING" }));
    const res = await queueStatus("a1", "IN_PROGRESS");
    expect(res.status).toBe(200);
    expect(state.appts.get("a1")!.status).toBe("IN_PROGRESS");
  });

  it("reception still drives any doctor's queue", async () => {
    state.appts.set("a1", appt("a1"));
    const res = await queueStatus("a1", "WAITING");
    expect(res.status).toBe(200);
  });
});

describe("Q-04 — «Не пришёл» follows the visit's time", () => {
  it("NO_SHOW for a visit two hours ahead: 409 too_early_for_no_show", async () => {
    const later = new Date(NOW.getTime() + 120 * MIN);
    state.appts.set("a1", appt("a1", { date: later }));
    const res = await queueStatus("a1", "NO_SHOW");
    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("too_early_for_no_show");
    expect(h.updates).toEqual([]);
    expect(h.fireTrigger).not.toHaveBeenCalled();
  });

  it("after the slot has started the no-show lands and notifies like the generic PATCH", async () => {
    state.appts.set("a1", appt("a1"));
    const res = await queueStatus("a1", "NO_SHOW");
    expect(res.status).toBe(200);
    expect(state.appts.get("a1")).toMatchObject({
      status: "NO_SHOW",
      queueStatus: "NO_SHOW",
    });
    // AP-04 — the canonical slug every no-show path now fires.
    expect(h.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "a1",
    });
  });

  it("the P2 exception holds: «Пришёл» after the sweep's own no-show checks the patient in", async () => {
    state.appts.set("a1", appt("a1", { status: "NO_SHOW", queueStatus: "NO_SHOW" }));
    h.auditRows = [
      { entityId: "a1", action: "appointment.auto-no-show", createdAt: new Date(NOW.getTime() - 5 * MIN) },
    ];
    const res = await queueStatus("a1", "WAITING");
    expect(res.status).toBe(200);
    expect(state.appts.get("a1")).toMatchObject({
      status: "WAITING",
      queueStatus: "WAITING",
    });
    expect(h.fireTrigger).not.toHaveBeenCalled();
  });
});
