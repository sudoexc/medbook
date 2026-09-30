/**
 * Audit AP-04: every path that marks a no-show runs the same effects.
 *
 * The free-repeat engine never counts a NO_SHOW as a case's first visit, so
 * a missed first consultation must send the case's follow-up back to full
 * price. Only the drawer's PATCH repriced the case; the cabinet's «Не
 * пришёл» (queue-status), reception's bulk «Не пришёл» and the sweep wrote
 * the status alone and left the follow-up at 0 сум. The bulk cancel wrote
 * the status alone too: no reprice, no message, reminders kept queued.
 *
 * Three halves:
 *   1. `runNoShowEffects` / `repriceCase(s)AfterNoShow` themselves;
 *   2. queue-status and bulk-status NO_SHOW call them, once per row that
 *      really flipped, the reprice inside the write's transaction;
 *   3. bulk-status CANCELLED goes through the cancel kernel per row.
 * (The sweep is pinned in no-show-sweep-queue-status.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  fireTrigger: vi.fn(),
  retire: vi.fn(async () => 0),
  recomputeCase: vi.fn(async () => [] as unknown[]),
  effects: vi.fn(async () => undefined),
  repriceOne: vi.fn(async () => undefined),
  repriceMany: vi.fn(async () => undefined),
  cancel: vi.fn(async () => ({ ok: true })),
  /** Set by the $transaction mock while a transaction body runs. */
  txDepth: 0,
  repricedInTx: [] as boolean[],
}));

// ----- 1. the shared pieces -------------------------------------------------

describe("no-show kernel", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({ prisma: {} }));
    vi.doMock("@/server/notifications/triggers", () => ({
      fireTrigger: h.fireTrigger,
    }));
    vi.doMock("@/server/actions/in-clinic", () => ({
      retireVisitRiskActions: h.retire,
    }));
    vi.doMock("@/server/pricing/recompute-appointment-price", () => ({
      recomputeCaseAppointments: h.recomputeCase,
    }));
    h.fireTrigger.mockClear();
    h.retire.mockClear();
    h.recomputeCase.mockClear();
  });

  it("runNoShowEffects: the canonical message slug and the risk tasks", async () => {
    const { runNoShowEffects } = await import("@/server/appointments/no-show");
    await runNoShowEffects({ clinicId: "c1", appointmentId: "a1" });
    expect(h.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "a1",
    });
    expect(h.retire).toHaveBeenCalledWith(expect.anything(), "c1", "a1", "NO_SHOW");
  });

  it("repriceCaseAfterNoShow: the case when there is one, nothing otherwise", async () => {
    const { repriceCaseAfterNoShow } = await import("@/server/appointments/no-show");
    const tx = { tx: true };
    await repriceCaseAfterNoShow(tx as never, "case_1");
    await repriceCaseAfterNoShow(tx as never, null);
    expect(h.recomputeCase).toHaveBeenCalledTimes(1);
    expect(h.recomputeCase).toHaveBeenCalledWith(tx, "case_1");
  });

  it("repriceCasesAfterNoShow: each case once, however many visits share it", async () => {
    const { repriceCasesAfterNoShow } = await import("@/server/appointments/no-show");
    await repriceCasesAfterNoShow({} as never, ["case_1", null, "case_1", "case_2"]);
    expect(h.recomputeCase.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      "case_1",
      "case_2",
    ]);
  });
});

// ----- 2 + 3. the routes ----------------------------------------------------

const state = { appts: new Map<string, Row>() };

function appt(id: string, over: Row = {}): Row {
  const start = new Date(Date.now() - 90 * 60_000);
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
    durationMin: 30,
    startedAt: null,
    completedAt: null,
    queueOrder: null,
    ticketSeq: null,
    queuedAt: null,
    medicalCaseId: null,
    ...over,
  };
}

function mountRouteMocks() {
  vi.resetModules();
  vi.doUnmock("@/server/notifications/triggers");
  vi.doUnmock("@/server/actions/in-clinic");
  vi.doUnmock("@/server/pricing/recompute-appointment-price");
  vi.doMock("@/lib/auth", () => ({
    auth: vi.fn(async () => ({
      user: { id: "u_recept", role: "RECEPTIONIST", clinicId: "c1", email: "x@example.test" },
    })),
  }));
  vi.doMock("@/lib/pin", () => ({ hasValidPin: () => false }));
  vi.doMock("@/lib/tenant-context", () => ({
    runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
    getTenant: () => ({
      kind: "TENANT" as const,
      clinicId: "c1",
      userId: "u_recept",
      role: "RECEPTIONIST",
    }),
  }));
  vi.doMock("@/server/platform/branch-cookie", () => ({
    readActiveBranchFromCookieHeader: () => null,
  }));
  vi.doMock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
  vi.doMock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
  vi.doMock("@/server/realtime/outbox", () => ({
    newCorrelationId: () => "corr_test",
    publishViaOutbox: vi.fn(async () => undefined),
  }));
  vi.doMock("@/server/appointments/emit-change", () => ({
    emitAppointmentChangeViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
  }));
  vi.doMock("@/server/notifications/triggers", () => ({ fireTrigger: h.fireTrigger }));
  vi.doMock("@/server/telegram/call-notice", () => ({
    sendCallNotice: vi.fn(async () => true),
  }));
  vi.doMock("@/server/visit-notes/unsigned-draft", () => ({
    findUnsignedDraft: vi.fn(async () => null),
  }));
  vi.doMock("@/server/pricing/recompute-appointment-price", () => ({
    recomputeAppointmentPrice: vi.fn(async () => null),
    recomputeCaseAppointments: vi.fn(async () => undefined),
  }));
  vi.doMock("@/server/appointments/completion-effects", () => ({
    runCompletionEffects: vi.fn(async () => undefined),
  }));
  vi.doMock("@/server/appointments/cancel", () => ({ cancelAppointment: h.cancel }));
  vi.doMock("@/server/appointments/no-show", () => ({
    NO_SHOW_FIELDS: { status: "NO_SHOW", queueStatus: "NO_SHOW" },
    runNoShowEffects: h.effects,
    repriceCaseAfterNoShow: vi.fn(async (...args: unknown[]) => {
      h.repricedInTx.push(h.txDepth > 0);
      return (h.repriceOne as (...a: unknown[]) => Promise<void>)(...args);
    }),
    repriceCasesAfterNoShow: vi.fn(async (...args: unknown[]) => {
      h.repricedInTx.push(h.txDepth > 0);
      return (h.repriceMany as (...a: unknown[]) => Promise<void>)(...args);
    }),
  }));
  vi.doMock("@/lib/prisma", () => {
    const merge = (id: string, data: Row): Row => {
      const next = { ...state.appts.get(id), ...data };
      state.appts.set(id, next);
      return next;
    };
    const decorate = (row: Row | undefined) =>
      row
        ? {
            ...row,
            patient: { fullName: "Каримов Азиз", telegramId: null, preferredLang: "RU" },
            doctor: { nameRu: "Султанов А.", ticketPrefix: "A", cabinet: null },
            clinic: { id: "c1", slug: "neurofax", tgBotToken: null, tgBotUsername: null },
          }
        : undefined;
    const appointment = {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = state.appts.get(where.id);
        return row ? { ...row, doctor: { userId: "u_doc" } } : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) =>
        decorate(state.appts.get(where.id)),
      ),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => state.appts.get(id)).filter(Boolean),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) =>
        decorate(merge(where.id, data)),
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: { in: string[] } }; data: Row }) => {
          for (const id of where.id.in) merge(id, data);
          return { count: where.id.in.length };
        },
      ),
    };
    const prisma = {
      appointment,
      auditLog: {
        create: vi.fn(async () => ({ id: "al_1" })),
        findMany: vi.fn(async () => []),
      },
      $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => {
        h.txDepth += 1;
        try {
          return await fn(prisma);
        } finally {
          h.txDepth -= 1;
        }
      }),
    };
    return { prisma };
  });
}

function json(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("AP-04: every no-show path reprices the case and runs the effects", () => {
  beforeEach(() => {
    mountRouteMocks();
    h.effects.mockClear();
    h.repriceOne.mockClear();
    h.repriceMany.mockClear();
    h.cancel.mockClear();
    h.fireTrigger.mockClear();
    h.repricedInTx = [];
    h.txDepth = 0;
    state.appts = new Map();
  });

  it("queue-status NO_SHOW (the cabinet's «Не пришёл»)", async () => {
    state.appts.set("a1", appt("a1", { medicalCaseId: "case_1" }));
    const { PATCH } = await import(
      "@/app/api/crm/appointments/[id]/queue-status/route"
    );
    const res = await PATCH(
      json("https://x/api/crm/appointments/a1/queue-status", "PATCH", {
        queueStatus: "NO_SHOW",
      }),
    );
    expect(res.status).toBe(200);
    expect(state.appts.get("a1")).toMatchObject({
      status: "NO_SHOW",
      queueStatus: "NO_SHOW",
    });
    expect(h.repriceOne).toHaveBeenCalledWith(expect.anything(), "case_1");
    expect(h.repricedInTx).toEqual([true]);
    expect(h.effects).toHaveBeenCalledTimes(1);
    expect(h.effects).toHaveBeenCalledWith({ clinicId: "c1", appointmentId: "a1" });
  });

  it("bulk-status NO_SHOW: once per row that really flips, cases in the transaction", async () => {
    state.appts.set("a1", appt("a1", { medicalCaseId: "case_1" }));
    state.appts.set("a2", appt("a2", { medicalCaseId: null }));
    state.appts.set(
      "a3",
      appt("a3", { status: "NO_SHOW", queueStatus: "NO_SHOW", medicalCaseId: "case_3" }),
    );
    const { POST } = await import("@/app/api/crm/appointments/bulk-status/route");
    const res = await POST(
      json("https://x/api/crm/appointments/bulk-status", "POST", {
        ids: ["a1", "a2", "a3"],
        status: "NO_SHOW",
      }),
    );
    expect(res.status).toBe(200);
    for (const id of ["a1", "a2", "a3"]) {
      expect(state.appts.get(id)).toMatchObject({
        status: "NO_SHOW",
        queueStatus: "NO_SHOW",
      });
    }
    // a3 was a no-show already: its case and its message are not touched again.
    expect(h.repriceMany).toHaveBeenCalledWith(expect.anything(), ["case_1", null]);
    expect(h.repricedInTx).toEqual([true]);
    expect(h.effects.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      { clinicId: "c1", appointmentId: "a1" },
      { clinicId: "c1", appointmentId: "a2" },
    ]);
    // No stray legacy trigger for a3.
    expect(h.fireTrigger).not.toHaveBeenCalled();
  });

  it("bulk-status CANCELLED goes through the cancel kernel per row", async () => {
    state.appts.set("a1", appt("a1", { medicalCaseId: "case_1" }));
    state.appts.set("a2", appt("a2"));
    const { POST } = await import("@/app/api/crm/appointments/bulk-status/route");
    const res = await POST(
      json("https://x/api/crm/appointments/bulk-status", "POST", {
        ids: ["a1", "a2"],
        status: "CANCELLED",
        cancelReason: "Врач заболел",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2 });
    expect(h.cancel).toHaveBeenCalledTimes(2);
    expect(h.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "a1",
        clinicId: "c1",
        actorId: "u_recept",
        reason: "Врач заболел",
        surface: "CRM",
      }),
    );
    expect(h.effects).not.toHaveBeenCalled();
  });
});
