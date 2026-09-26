/**
 * Audit Q-13: «one patient on the table» was a read without a lock and
 * without a day bound.
 *
 *   - Race: reception's «Вызвать из очереди» and the doctor's «Вызвать» on
 *     another patient both read "no visit in progress" and both wrote
 *     IN_PROGRESS. The check now runs inside the start write's own
 *     Serializable transaction (`runStartVisitTx` over `runQueueTx`): the
 *     second transaction aborts with 40001, its retry sees the committed
 *     visit, and the caller gets 409.
 *   - Stale row: a visit the doctor forgot to close yesterday answered every
 *     «Вызвать» this morning with «уже идёт приём: <вчерашний пациент>»,
 *     while «Мой день» showed nobody. The guard is bounded to the Tashkent
 *     day, and the lifecycle sweep closes such rows as COMPLETED, leaving
 *     their drafts unsigned and in place.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tashkentDayBounds } from "@/lib/booking-validation";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  findFirst: vi.fn(async (_args: { where: Row }): Promise<Row | null> => null),
  update: vi.fn(async (_args: Row): Promise<Row> => ({})),
  txOptions: [] as unknown[],
  /** When set, the next transaction fails once with a write conflict. */
  failNextTxWith: null as null | { code: string },
  // Sweep
  sweepFindMany: vi.fn(async (_args: Row): Promise<Row[]> => []),
  updateMany: vi.fn(async (_args: Row) => ({ count: 1 })),
  visitNoteFindFirst: vi.fn(async (_args: Row): Promise<Row | null> => null),
  visitNoteWrites: [] as string[],
  audits: [] as Row[],
  publishes: [] as Row[],
  fireTrigger: vi.fn(),
  refreshStats: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_doc_1",
    role: "DOCTOR" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn((_c: string, ev: Row) => {
    h.publishes.push(ev);
  }),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/appointments/emit-change", () => ({
  emitAppointmentChangeViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
}));
vi.mock("@/server/telegram/send", () => ({
  sendMessage: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: h.fireTrigger,
}));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async () => undefined),
  refreshPatientVisitStats: h.refreshStats,
}));
vi.mock("@/server/queue", () => ({
  getQueue: () => ({ registerWorker: vi.fn(), repeat: vi.fn() }),
}));

vi.mock("@/lib/prisma", () => {
  const prisma: Row = {
    appointment: {
      findUnique: vi.fn(async () => ({
        id: "apt_2",
        clinicId: "c1",
        patientId: "p2",
        doctorId: "doc_1",
        status: "WAITING",
        queueStatus: "WAITING",
        date: new Date(),
        startedAt: null,
        completedAt: null,
        doctor: { userId: "u_doc_1" },
      })),
      findFirst: h.findFirst,
      update: h.update,
      findMany: h.sweepFindMany,
      updateMany: h.updateMany,
    },
    visitNote: {
      findFirst: h.visitNoteFindFirst,
      update: vi.fn(async () => {
        h.visitNoteWrites.push("update");
        return {};
      }),
      delete: vi.fn(async () => {
        h.visitNoteWrites.push("delete");
        return {};
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        h.audits.push(data);
        return { id: "al_1" };
      }),
    },
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => {
        h.txOptions.push(opts);
        const result = await fn(prisma);
        if (h.failNextTxWith) {
          // Postgres aborts at commit: the work above is rolled back.
          const e = h.failNextTxWith;
          h.failNextTxWith = null;
          throw Object.assign(new Error("could not serialize access"), e);
        }
        return result;
      },
    ),
  };
  return { prisma };
});

beforeEach(() => {
  vi.resetModules();
  h.findFirst.mockReset().mockResolvedValue(null);
  h.update.mockReset().mockImplementation(async ({ data }: Row) => ({
    id: "apt_2",
    status: "IN_PROGRESS",
    queueStatus: "IN_PROGRESS",
    queueOrder: 2,
    ticketSeq: 2,
    calledAt: new Date(),
    date: new Date(),
    doctorId: "doc_1",
    patientId: "p2",
    cabinetId: null,
    patient: { fullName: "Каримов Бахром", telegramId: null },
    doctor: { nameRu: "Султанов А.", cabinet: null },
    clinic: { id: "c1", slug: "neurofax", tgBotToken: null, tgBotUsername: null },
    ...(data as Row),
  }));
  h.txOptions = [];
  h.failNextTxWith = null;
  h.sweepFindMany.mockReset().mockResolvedValue([]);
  h.updateMany.mockReset().mockResolvedValue({ count: 1 });
  h.visitNoteFindFirst.mockReset().mockResolvedValue(null);
  h.visitNoteWrites = [];
  h.audits = [];
  h.publishes = [];
  h.fireTrigger.mockClear();
  h.refreshStats.mockClear();
});

describe("findOtherActiveVisit — bounded to the clinic day", () => {
  it("ignores an IN_PROGRESS row slotted and started on an earlier day", async () => {
    const { findOtherActiveVisit } = await import(
      "@/server/appointments/active-visit"
    );
    // 00:30 in Tashkent — the server (UTC) is still on the previous date.
    const now = new Date("2026-09-25T19:30:00.000Z");
    const { dayStart } = tashkentDayBounds(now);
    expect(dayStart.toISOString()).toBe("2026-09-25T19:00:00.000Z");

    await findOtherActiveVisit({
      clinicId: "c1",
      doctorId: "doc_1",
      excludeAppointmentId: "apt_2",
      now,
    });

    const where = h.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      clinicId: "c1",
      doctorId: "doc_1",
      status: "IN_PROGRESS",
      id: { not: "apt_2" },
    });
    expect(where.OR).toEqual([
      { date: { gte: dayStart } },
      { startedAt: { gte: dayStart } },
    ]);
  });

  it("the stale-row predicate is the exact complement the sweep closes", async () => {
    const { staleInProgressWhere } = await import(
      "@/server/appointments/stale-visit"
    );
    const dayStart = new Date("2026-09-25T19:00:00.000Z");
    expect(staleInProgressWhere(dayStart)).toEqual({
      status: "IN_PROGRESS",
      date: { lt: dayStart },
      OR: [{ startedAt: null }, { startedAt: { lt: dayStart } }],
    });
  });
});

describe("runStartVisitTx — check and write in one Serializable transaction", () => {
  it("refuses inside the transaction, before the write", async () => {
    h.findFirst.mockResolvedValue({
      id: "apt_1",
      patient: { fullName: "Рахимов Сардор" },
    });
    const { runStartVisitTx, AnotherVisitInProgressError } = await import(
      "@/server/appointments/active-visit"
    );
    const write = vi.fn(async () => "written");

    await expect(
      runStartVisitTx(
        { clinicId: "c1", doctorId: "doc_1", appointmentId: "apt_2" },
        write,
      ),
    ).rejects.toBeInstanceOf(AnotherVisitInProgressError);
    expect(write).not.toHaveBeenCalled();
    expect(h.txOptions).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it("two parallel starts: the loser's retry sees the winner and gets a conflict", async () => {
    const { runStartVisitTx, AnotherVisitInProgressError } = await import(
      "@/server/appointments/active-visit"
    );
    // Attempt 1 reads a free doctor, writes, and is aborted at commit by
    // Postgres (the winner committed a visit matching its read predicate).
    // Attempt 2 reads again and now sees the winner's visit.
    h.failNextTxWith = { code: "P2034" };
    h.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "apt_1", patient: { fullName: "Рахимов Сардор" } });
    const write = vi.fn(async () => "written");

    const outcome = await runStartVisitTx(
      { clinicId: "c1", doctorId: "doc_1", appointmentId: "apt_2" },
      write,
    ).catch((e: unknown) => e);

    expect(outcome).toBeInstanceOf(AnotherVisitInProgressError);
    expect((outcome as InstanceType<typeof AnotherVisitInProgressError>).activeAppointmentId).toBe("apt_1");
    // One (rolled back) write from the aborted attempt, none from the retry.
    expect(write).toHaveBeenCalledTimes(1);
    expect(h.txOptions).toHaveLength(2);
  });
});

describe("PATCH ?call=true — the doctor's «Вызвать»", () => {
  async function call(): Promise<Response> {
    const { PATCH } = await import("@/app/api/crm/appointments/[id]/route");
    return PATCH(
      new Request("https://x/api/crm/appointments/apt_2?call=true", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
  }

  it("answers 409 naming the patient on the table, and writes nothing", async () => {
    h.findFirst.mockResolvedValue({
      id: "apt_1",
      patient: { fullName: "Рахимов Сардор" },
    });

    const res = await call();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      reason: "another_visit_in_progress",
      activeAppointmentId: "apt_1",
      activePatientName: "Рахимов Сардор",
    });
    expect(h.update).not.toHaveBeenCalled();
    // The check ran on the transaction client, under Serializable.
    expect(h.txOptions).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it("starts the visit when the doctor is free today", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0]).toMatchObject({
      where: { id: "apt_2" },
      data: { status: "IN_PROGRESS", queueStatus: "IN_PROGRESS" },
    });
  });
});

describe("lifecycle sweep — stale IN_PROGRESS from earlier days", () => {
  const now = new Date("2026-09-26T04:00:00.000Z"); // 09:00 Tashkent

  function staleRow(over: Row = {}): Row {
    return {
      id: "apt_old",
      clinicId: "c1",
      doctorId: "doc_1",
      patientId: "p_old",
      date: new Date("2026-09-25T10:00:00.000Z"),
      startedAt: new Date("2026-09-25T10:05:00.000Z"),
      durationMin: 20,
      ...over,
    };
  }

  it("closes yesterday's forgotten visit as COMPLETED, conditional on it still being IN_PROGRESS", async () => {
    h.sweepFindMany.mockResolvedValue([staleRow()]);
    h.visitNoteFindFirst.mockResolvedValue({ id: "vn_old" });
    const { closeStaleInProgressVisits } = await import(
      "@/server/workers/appointment-lifecycle-sweep"
    );

    const out = await closeStaleInProgressVisits(now);

    expect(out).toEqual({ scanned: 1, closed: 1 });
    const { dayStart } = tashkentDayBounds(now);
    expect(h.sweepFindMany.mock.calls[0][0]).toMatchObject({
      where: {
        status: "IN_PROGRESS",
        date: { lt: dayStart },
        OR: [{ startedAt: null }, { startedAt: { lt: dayStart } }],
      },
    });
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { id: "apt_old", status: "IN_PROGRESS" },
      data: {
        status: "COMPLETED",
        queueStatus: "COMPLETED",
        // Started 10:05 UTC + 20 min: the visit's own day, not "now".
        completedAt: new Date("2026-09-25T10:25:00.000Z"),
      },
    });
  });

  it("never signs or deletes the draft: it only names it in the audit trail", async () => {
    h.sweepFindMany.mockResolvedValue([staleRow()]);
    h.visitNoteFindFirst.mockResolvedValue({ id: "vn_old" });
    const { closeStaleInProgressVisits } = await import(
      "@/server/workers/appointment-lifecycle-sweep"
    );

    await closeStaleInProgressVisits(now);

    expect(h.visitNoteWrites).toEqual([]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      clinicId: "c1",
      action: "appointment.auto-close-stale-visit",
      entityId: "apt_old",
      actorLabel: "system",
      meta: { from: "IN_PROGRESS", to: "COMPLETED", unsignedVisitNoteId: "vn_old" },
    });
    // Screens refresh; no «Спасибо за визит» after midnight.
    expect(h.publishes).toEqual([
      {
        type: "appointment.statusChanged",
        payload: {
          appointmentId: "apt_old",
          doctorId: "doc_1",
          status: "COMPLETED",
          previousStatus: "IN_PROGRESS",
        },
      },
    ]);
    expect(h.fireTrigger).not.toHaveBeenCalled();
    expect(h.refreshStats).toHaveBeenCalledWith("p_old");
  });

  it("a visit the doctor closed at that very moment is left alone", async () => {
    h.sweepFindMany.mockResolvedValue([staleRow()]);
    h.updateMany.mockResolvedValue({ count: 0 });
    const { closeStaleInProgressVisits } = await import(
      "@/server/workers/appointment-lifecycle-sweep"
    );

    const out = await closeStaleInProgressVisits(now);

    expect(out).toEqual({ scanned: 1, closed: 0 });
    expect(h.audits).toEqual([]);
    expect(h.publishes).toEqual([]);
  });

  it("estimates the end from the slot when the visit has no start stamp", async () => {
    const { staleVisitCompletedAt } = await import(
      "@/server/appointments/stale-visit"
    );
    expect(
      staleVisitCompletedAt({
        date: new Date("2026-09-25T10:00:00.000Z"),
        startedAt: null,
        durationMin: 30,
      }),
    ).toEqual(new Date("2026-09-25T10:30:00.000Z"));
  });
});
