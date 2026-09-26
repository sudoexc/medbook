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
import { beforeEach, describe, expect, it, vi } from "vitest";

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
};

const h = vi.hoisted(() => ({
  fireTrigger: vi.fn(),
  publishes: [] as Array<{ type: string; payload: Record<string, unknown> }>,
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
vi.mock("@/lib/prisma", () => ({
  prisma: {
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
  },
}));

import {
  _tickForTests as tick,
  autoNoShowWhere,
  selectAutoNoShows,
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
    ...over,
  };
}

beforeEach(() => {
  state.rows = [];
  h.fireTrigger.mockClear();
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
