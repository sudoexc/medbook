/**
 * Audit Q-14: the auto no-show sweep.
 *
 *   - It wrote `status: NO_SHOW` alone. Reception lays its lanes out by
 *     `queueStatus`, so the no-show stayed in «Записи» as «Подтверждена»
 *     with a «Пришёл» button, and queue-status (which reads `queueStatus`)
 *     let that button bring it back to life.
 *   - It swept walk-ins too. A live-queue row's `endDate` is registration +
 *     30 min, a technical window: a walk-in who waited 90 minutes and was
 *     skipped while in the corridor became a NO_SHOW and got «вы не пришли».
 *
 * Acceptance: after a tick the auto no-show has status = queueStatus =
 * NO_SHOW; a SKIPPED walk-in registered two hours ago is untouched and gets
 * no no-show message. (queue-status refusing to revive a row whose `status`
 * is already terminal is pinned in queue-status-visit-day.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  channel: string;
  status: string;
  queueStatus: string;
  date: Date;
  endDate: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  queueOrder: number | null;
  queuedAt: Date | null;
  medicalCaseId?: string | null;
  arrivedAt?: Date | null;
  patient?: { fullName: string };
  doctor?: { nameRu: string };
};

const h = vi.hoisted(() => ({
  fireTrigger: vi.fn(),
  publishes: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  recomputeCase: vi.fn(async (_tx: unknown, _caseId: string) => [] as unknown[]),
  retireRisk: vi.fn(async () => 0),
  /** Reception tasks raised so far, by dedupe key (G3-01 review). */
  taskKeys: new Set<string>(),
  upsertAction: vi.fn(),
  /** Whether the case reprice ran inside the transaction. */
  inTx: false,
}));

const state = { rows: [] as Row[] };

type Filter = Record<string, unknown>;

/** Just enough of Prisma's `where` for the sweep's three scans. */
function matches(r: Row, where: Filter): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as Filter[]).some((c) => matches(r, c))) return false;
      continue;
    }
    const v = r[key as keyof Row];
    if (cond === null) {
      if (v !== null) return false;
    } else if (typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
      if ("not" in c && v === c.not) return false;
      if ("lt" in c && !(v instanceof Date && v < (c.lt as Date))) return false;
      if ("gte" in c && !(v instanceof Date && v >= (c.gte as Date))) return false;
    } else if (v !== cond) {
      return false;
    }
  }
  return true;
}

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "SYSTEM" as const }),
}));
vi.mock("@/server/queue", () => ({
  getQueue: () => ({ registerWorker: vi.fn(), repeat: vi.fn() }),
}));
vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: h.fireTrigger,
}));
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn(
    (_c: string, ev: { type: string; payload: Record<string, unknown> }) => {
      h.publishes.push(ev);
    },
  ),
}));
vi.mock("@/server/patient/last-contacted", () => ({
  refreshPatientVisitStats: vi.fn(async () => undefined),
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeCaseAppointments: vi.fn(async (tx: unknown, caseId: string) => {
    h.inTx = (tx as { __tx?: boolean }).__tx === true;
    return h.recomputeCase(tx, caseId);
  }),
}));
vi.mock("@/server/actions/in-clinic", () => ({
  retireVisitRiskActions: h.retireRisk,
}));
vi.mock("@/server/actions/repository", () => ({
  upsertAction: h.upsertAction,
}));
vi.mock("@/lib/prisma", () => {
  const prisma = {
    appointment: {
      findMany: vi.fn(async ({ where }: { where: Filter }) =>
        state.rows.filter((r) => matches(r, where)),
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: Filter; data: Partial<Row> }) => {
          let count = 0;
          for (const r of state.rows) {
            if (matches(r, where)) {
              Object.assign(r, data);
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    visitNote: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async () => ({ id: "al" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) =>
      fn({ ...prisma, __tx: true }),
    ),
  };
  return { prisma };
});

import {
  _tickForTests as tick,
  autoNoShowWhere,
  selectAutoNoShows,
  selfCheckInSweepWhere,
  splitCheckedInPastCutoff,
  SELF_CHECK_IN_LOOKBACK_HOURS,
} from "@/server/workers/appointment-lifecycle-sweep";

const HOUR = 60 * 60_000;

function row(over: Partial<Row>): Row {
  const date = new Date(Date.now() - 3 * HOUR);
  return {
    id: "r",
    clinicId: "c1",
    doctorId: "doc_1",
    patientId: "p1",
    channel: "PHONE",
    status: "CONFIRMED",
    queueStatus: "CONFIRMED",
    date,
    endDate: new Date(date.getTime() + 30 * 60_000),
    startedAt: null,
    completedAt: null,
    queueOrder: null,
    queuedAt: null,
    arrivedAt: null,
    ...over,
  };
}

beforeEach(() => {
  state.rows = [];
  h.fireTrigger.mockClear();
  h.recomputeCase.mockClear();
  h.retireRisk.mockClear();
  h.taskKeys = new Set();
  // The real upsert is keyed by (clinic, dedupe key): created once, then a
  // silent refresh (its closed-row rules live in action-snooze-expiry).
  h.upsertAction.mockReset();
  h.upsertAction.mockImplementation(
    async (_p: unknown, clinicId: string, payload: { type: string; appointmentId: string }) => {
      const key = `${clinicId}|${payload.type}:${payload.appointmentId}`;
      const created = !h.taskKeys.has(key);
      h.taskKeys.add(key);
      return {
        id: `act_${payload.appointmentId}`,
        created,
        severity: "high",
        payloadChanged: false,
        severityChanged: false,
        keptClosed: false,
      };
    },
  );
  h.inTx = false;
  h.publishes = [];
});

describe("Q-14: the auto no-show moves both status columns", () => {
  it("a stale phone booking becomes NO_SHOW in status AND queueStatus", async () => {
    state.rows = [row({ id: "booking" })];

    await tick();

    expect(state.rows[0]).toMatchObject({
      status: "NO_SHOW",
      queueStatus: "NO_SHOW",
    });
    expect(h.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "booking",
    });
    // Reception's lanes follow `queueStatus`: the boards hear about it.
    expect(
      h.publishes.some(
        (p) => p.type === "queue.updated" && p.payload.queueStatus === "NO_SHOW",
      ),
    ).toBe(true);
  });

  it("a SKIPPED walk-in registered two hours ago is left alone, no message", async () => {
    const registered = new Date(Date.now() - 2 * HOUR);
    state.rows = [
      row({
        id: "walkin",
        channel: "WALKIN",
        status: "SKIPPED",
        queueStatus: "SKIPPED",
        date: registered,
        endDate: new Date(registered.getTime() + 30 * 60_000),
      }),
    ];

    await tick();

    expect(state.rows[0]).toMatchObject({
      status: "SKIPPED",
      queueStatus: "SKIPPED",
    });
    expect(h.fireTrigger).not.toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "walkin",
    });
  });

  it("a row reception moved on between scan and write is not overwritten", async () => {
    // What updateMany sees: the row is WAITING by now, so the conditional
    // write (status as scanned) matches nothing.
    state.rows = [row({ id: "moved" })];
    const { prisma } = await import("@/lib/prisma");
    const findMany = vi.mocked(prisma.appointment.findMany) as unknown as {
      mockImplementationOnce: (fn: () => Promise<unknown>) => void;
    };
    findMany.mockImplementationOnce(async () => []); // stale-visit scan
    findMany.mockImplementationOnce(async () => []); // check-in pass
    findMany.mockImplementationOnce(async () => {
      const scanned = state.rows.map((r) => ({ ...r }));
      state.rows[0].status = "WAITING";
      state.rows[0].queueStatus = "WAITING";
      return scanned;
    });

    await tick();

    expect(state.rows[0]).toMatchObject({
      status: "WAITING",
      queueStatus: "WAITING",
    });
    expect(h.fireTrigger).not.toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "moved",
    });
  });

  // Final review: SKIPPED is reached only from WAITING, so a skipped phone
  // booking is a patient who came. Once the sweep moved `queueStatus` too,
  // she dropped out of reception's lanes at 10:30 and «Вызвать» / «Пришёл»
  // refused her (queue-status will not leave NO_SHOW).
  it("a phone booking that checked in and was skipped is left in the queue, no message", async () => {
    const slot = new Date(Date.now() - 2 * HOUR);
    state.rows = [
      row({
        id: "skipped-booking",
        channel: "PHONE",
        status: "SKIPPED",
        queueStatus: "SKIPPED",
        date: slot,
        endDate: new Date(slot.getTime() + 30 * 60_000),
        queueOrder: 3,
        queuedAt: new Date(slot.getTime() - 10 * 60_000),
      }),
    ];

    await tick();

    expect(state.rows[0]).toMatchObject({
      status: "SKIPPED",
      queueStatus: "SKIPPED",
    });
    expect(h.fireTrigger).not.toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "skipped-booking",
    });
    expect(h.publishes.some((p) => p.payload.appointmentId === "skipped-booking")).toBe(false);
  });

  it("a booking whose status lags behind a WAITING queue column is left alone", async () => {
    state.rows = [row({ id: "drifted", status: "CONFIRMED", queueStatus: "WAITING" })];

    await tick();

    expect(state.rows[0]).toMatchObject({
      status: "CONFIRMED",
      queueStatus: "WAITING",
    });
    expect(h.fireTrigger).not.toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "drifted",
    });
  });

  it("the scan filter and the pure selector agree: arrived rows never qualify", () => {
    const where = autoNoShowWhere(new Date());
    expect(where.status.in).not.toContain("SKIPPED");
    expect(where.queueStatus.in).toEqual(["BOOKED", "CONFIRMED"]);
    const old = new Date(Date.now() - 5 * HOUR);
    const base = {
      clinicId: "c1",
      doctorId: "doc_1",
      date: new Date(old.getTime() - 30 * 60_000),
      endDate: old,
      channel: "PHONE",
    };
    const picked = selectAutoNoShows(
      [
        { ...base, id: "c", status: "CONFIRMED", queueStatus: "CONFIRMED" },
        { ...base, id: "s", status: "SKIPPED", queueStatus: "SKIPPED" },
        { ...base, id: "d", status: "CONFIRMED", queueStatus: "WAITING" },
      ],
      new Date(),
    );
    expect(picked.map((r) => r.id)).toEqual(["c"]);
  });

  it("the scan filter and the pure selector agree: walk-ins never qualify", () => {
    const cutoff = new Date();
    expect(autoNoShowWhere(cutoff)).toMatchObject({
      channel: { not: "WALKIN" },
      endDate: { lt: cutoff },
    });
    const old = new Date(Date.now() - 5 * HOUR);
    const base = {
      clinicId: "c1",
      doctorId: "doc_1",
      date: new Date(old.getTime() - 30 * 60_000),
      endDate: old,
    };
    const picked = selectAutoNoShows(
      [
        { ...base, id: "b", status: "BOOKED", channel: "PHONE" },
        { ...base, id: "w", status: "SKIPPED", channel: "WALKIN" },
      ],
      new Date(),
    );
    expect(picked.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("AP-04: the auto no-show has the effects of every no-show", () => {
  it("reprices the case in the flip's transaction and closes the risk tasks", async () => {
    state.rows = [row({ id: "first", medicalCaseId: "case_1" })];

    await tick();

    expect(state.rows[0]).toMatchObject({ status: "NO_SHOW", queueStatus: "NO_SHOW" });
    // The free repeat that hung on this visit goes back to full price.
    expect(h.recomputeCase).toHaveBeenCalledTimes(1);
    expect(h.recomputeCase).toHaveBeenCalledWith(expect.anything(), "case_1");
    expect(h.inTx).toBe(true);
    expect(h.retireRisk).toHaveBeenCalledWith(
      expect.anything(),
      "c1",
      "first",
      "NO_SHOW",
    );
    expect(h.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "first",
    });
  });

  it("a visit outside any case has nothing to reprice", async () => {
    state.rows = [row({ id: "plain", medicalCaseId: null })];

    await tick();

    expect(state.rows[0].status).toBe("NO_SHOW");
    expect(h.recomputeCase).not.toHaveBeenCalled();
  });

  it("a row reception moved on in between: no reprice, no effects", async () => {
    state.rows = [row({ id: "moved", medicalCaseId: "case_1" })];
    const { prisma } = await import("@/lib/prisma");
    const findMany = vi.mocked(prisma.appointment.findMany) as unknown as {
      mockImplementationOnce: (fn: () => Promise<unknown>) => void;
    };
    findMany.mockImplementationOnce(async () => []); // stale-visit scan
    findMany.mockImplementationOnce(async () => []); // check-in pass
    findMany.mockImplementationOnce(async () => {
      const scanned = state.rows.map((r) => ({ ...r }));
      state.rows[0].status = "WAITING";
      state.rows[0].queueStatus = "WAITING";
      return scanned;
    });

    await tick();

    expect(h.recomputeCase).not.toHaveBeenCalled();
    expect(h.retireRisk).not.toHaveBeenCalled();
  });

  it("walk-ins stay out (P2 rule kept): no reprice either", async () => {
    const registered = new Date(Date.now() - 2 * HOUR);
    state.rows = [
      row({
        id: "walkin",
        channel: "WALKIN",
        status: "CONFIRMED",
        queueStatus: "CONFIRMED",
        date: registered,
        endDate: new Date(registered.getTime() + 30 * 60_000),
        medicalCaseId: "case_1",
      }),
    ];

    await tick();

    expect(state.rows[0].status).toBe("CONFIRMED");
    expect(h.recomputeCase).not.toHaveBeenCalled();
  });
});

describe("G3-01: a patient who checked in from the Mini App is not a no-show", () => {
  // A check-in counts on the visit's own clinic day only (review), so the
  // clock is pinned: rows built relative to «now» must not straddle midnight.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z")); // 17:00 Tashkent
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a booking with «Я на месте» is left alone, and gets no message", async () => {
    state.rows = [
      row({ id: "checked_in", arrivedAt: new Date(Date.now() - 2.5 * HOUR) }),
      row({ id: "absent" }),
    ];

    await tick();

    const byId = Object.fromEntries(state.rows.map((r) => [r.id, r]));
    expect(byId.checked_in).toMatchObject({ status: "CONFIRMED", queueStatus: "CONFIRMED" });
    expect(byId.absent).toMatchObject({ status: "NO_SHOW" });
    expect(h.fireTrigger).not.toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "checked_in",
    });
  });

  it("a check-in landing between the scan and the write wins", async () => {
    state.rows = [row({ id: "late_tap" })];
    const { prisma } = await import("@/lib/prisma");
    const findMany = vi.mocked(prisma.appointment.findMany) as unknown as {
      mockImplementationOnce: (fn: () => Promise<unknown>) => void;
    };
    findMany.mockImplementationOnce(async () => []); // stale-visit scan
    findMany.mockImplementationOnce(async () => []); // check-in pass
    findMany.mockImplementationOnce(async () => {
      const scanned = state.rows.map((r) => ({ ...r }));
      state.rows[0].arrivedAt = new Date();
      return scanned;
    });

    await tick();

    expect(state.rows[0].status).toBe("CONFIRMED");
    expect(h.fireTrigger).not.toHaveBeenCalled();
  });

  it("no «вы опаздываете» either", async () => {
    const start = new Date(Date.now() - 30 * 60_000);
    state.rows = [
      row({
        id: "in_hall",
        date: start,
        endDate: new Date(start.getTime() + 30 * 60_000),
        arrivedAt: new Date(start.getTime() - 5 * 60_000),
      }),
      row({
        id: "on_the_way",
        date: start,
        endDate: new Date(start.getTime() + 30 * 60_000),
      }),
      // The tick reaches the running-late pass only with a stale row too.
      row({ id: "stale" }),
    ];

    await tick();

    expect(h.fireTrigger).not.toHaveBeenCalledWith({
      kind: "appointment.running-late",
      appointmentId: "in_hall",
    });
    // The control: a patient who did not check in is still nudged.
    expect(h.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.running-late",
      appointmentId: "on_the_way",
    });
  });

  it("the scan filter and the pure selector agree", () => {
    expect(autoNoShowWhere(new Date())).toMatchObject({ arrivedAt: null });
    const old = new Date(Date.now() - 5 * HOUR);
    const picked = selectAutoNoShows(
      [
        {
          id: "x",
          clinicId: "c1",
          doctorId: "doc_1",
          status: "BOOKED",
          channel: "PHONE",
          date: new Date(old.getTime() - 30 * 60_000),
          endDate: old,
          arrivedAt: old,
        },
      ],
      new Date(),
    );
    expect(picked).toEqual([]);
  });
});

describe("G3-01 review: an unanswered check-in is reception's task, a stale stamp is nothing", () => {
  // 17:00 Tashkent on 01.10; the auto no-show cutoff is 16:00 (11:00Z).
  const NOW = new Date("2026-10-01T12:00:00.000Z");
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The 14:00 visit, tapped «Я на месте» at 13:55, nobody pressed «Пришёл».
  const unanswered = (over: Partial<Row> = {}) =>
    row({
      id: "in_hall",
      date: new Date("2026-10-01T09:00:00.000Z"),
      endDate: new Date("2026-10-01T09:30:00.000Z"),
      arrivedAt: new Date("2026-10-01T08:55:00.000Z"),
      patient: { fullName: "Рахимов Бекзод" },
      doctor: { nameRu: "Султанов А." },
      ...over,
    });
  // Tapped on 24.09 at 09:10, never met, moved by reception to today 14:00
  // before moves dropped the stamp.
  const STALE_TAP = new Date("2026-09-24T04:10:00.000Z");

  const createdPublishes = () => h.publishes.filter((p) => p.type === "action.created");

  it("at the cutoff the booking stays, reception gets one task on it, the patient no message", async () => {
    state.rows = [unanswered()];

    await tick();

    expect(state.rows[0]).toMatchObject({ status: "CONFIRMED", queueStatus: "CONFIRMED" });
    expect(h.fireTrigger).not.toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "in_hall",
    });
    expect(h.upsertAction).toHaveBeenCalledTimes(1);
    expect(h.upsertAction).toHaveBeenCalledWith(
      expect.anything(),
      "c1",
      {
        type: "SELF_CHECK_IN_UNHANDLED",
        appointmentId: "in_hall",
        patientId: "p1",
        patientName: "Рахимов Бекзод",
        doctorName: "Султанов А.",
        appointmentAt: "2026-10-01T09:00:00.000Z",
        arrivedAt: "2026-10-01T08:55:00.000Z",
      },
      // Lives until a person settles it or the visit moves on.
      { expiresAt: null },
    );
    expect(createdPublishes()).toEqual([
      {
        type: "action.created",
        payload: { id: "act_in_hall", type: "SELF_CHECK_IN_UNHANDLED", severity: "high" },
      },
    ]);

    // Ten minutes later: the same task, nothing new announced.
    await tick();
    expect(createdPublishes()).toHaveLength(1);
    expect(state.rows[0].status).toBe("CONFIRMED");
  });

  it("not before the cutoff: the desk still has its badge and alert", async () => {
    // The 16:00 visit ends 16:30, half an hour short of its cutoff.
    state.rows = [
      unanswered({
        date: new Date("2026-10-01T11:00:00.000Z"),
        endDate: new Date("2026-10-01T11:30:00.000Z"),
        arrivedAt: new Date("2026-10-01T10:55:00.000Z"),
      }),
    ];

    await tick();

    expect(h.upsertAction).not.toHaveBeenCalled();
  });

  it("a stamp from the day the visit was moved off is swept like any booking", async () => {
    state.rows = [unanswered({ id: "moved", arrivedAt: STALE_TAP })];

    await tick();

    expect(state.rows[0]).toMatchObject({ status: "NO_SHOW", queueStatus: "NO_SHOW" });
    expect(h.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "moved",
    });
    expect(h.upsertAction).not.toHaveBeenCalled();
  });

  it("his real tap landing between the scan and the write wins over the stale stamp", async () => {
    state.rows = [unanswered({ id: "moved", arrivedAt: STALE_TAP })];
    const { prisma } = await import("@/lib/prisma");
    const findMany = vi.mocked(prisma.appointment.findMany) as unknown as {
      mockImplementationOnce: (fn: () => Promise<unknown>) => void;
    };
    findMany.mockImplementationOnce(async () => []); // stale-visit scan
    findMany.mockImplementationOnce(async () => {
      const scanned = state.rows.map((r) => ({ ...r }));
      state.rows[0].arrivedAt = new Date(); // the Mini App re-claims it
      return scanned;
    });

    await tick();

    expect(state.rows[0].status).toBe("CONFIRMED");
    expect(h.fireTrigger).not.toHaveBeenCalledWith({
      kind: "appointment.no-show",
      appointmentId: "moved",
    });
  });

  it("the running-late text reaches a patient whose only stamp is from another day", async () => {
    const start = new Date(NOW.getTime() - 30 * 60_000);
    state.rows = [
      row({
        id: "on_the_way",
        date: start,
        endDate: new Date(start.getTime() + 30 * 60_000),
        arrivedAt: STALE_TAP,
      }),
      // The tick reaches the running-late pass only with a stale row too.
      row({ id: "stale" }),
    ];

    await tick();

    expect(h.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.running-late",
      appointmentId: "on_the_way",
    });
  });

  it("past the lookback window an undecided visit is not rescanned", async () => {
    const end = new Date(NOW.getTime() - (60 + (SELF_CHECK_IN_LOOKBACK_HOURS + 1) * 60) * 60_000);
    state.rows = [
      unanswered({
        date: new Date(end.getTime() - 30 * 60_000),
        endDate: end,
        arrivedAt: new Date(end.getTime() - 35 * 60_000),
      }),
    ];

    await tick();

    expect(h.upsertAction).not.toHaveBeenCalled();
    expect(state.rows[0].status).toBe("CONFIRMED");
  });

  it("the pure split and selector read the same rule", () => {
    const cutoff = new Date(NOW.getTime() - 60 * 60_000);
    expect(selfCheckInSweepWhere(cutoff)).toMatchObject({
      arrivedAt: { not: null },
      channel: { not: "WALKIN" },
      endDate: {
        lt: cutoff,
        gte: new Date(cutoff.getTime() - SELF_CHECK_IN_LOOKBACK_HOURS * HOUR),
      },
    });

    const fresh = { ...unanswered(), status: "CONFIRMED" as const, queueStatus: "CONFIRMED" as const };
    const stale = { ...fresh, id: "moved", arrivedAt: STALE_TAP };
    const walkin = { ...fresh, id: "walkin", channel: "WALKIN" };
    const split = splitCheckedInPastCutoff([fresh, stale, walkin], NOW);
    expect(split.answer.map((r) => r.id)).toEqual(["in_hall"]);
    expect(split.sweep.map((r) => r.id)).toEqual(["moved"]);

    // The no-show selector: a stale stamp protects nothing, a real one does.
    expect(selectAutoNoShows([fresh, stale], NOW).map((r) => r.id)).toEqual(["moved"]);
  });
});
