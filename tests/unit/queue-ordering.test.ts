/**
 * Two-lanes ordering spec (docs/TZ-two-lanes.md) — replaces the serveAt EDF
 * suite. The live queue is timeless FIFO over walk-ins only; bookings never
 * enter its order. `compareQueue` is shared verbatim by the server projection
 * and every client sort site, so these are THE invariants of the model:
 *
 *   I1 — order depends only on (queuePriority, queuedAt, ticketSeq);
 *        the row's slot `date` never matters
 *   I2 — `isLiveLane` splits strictly by channel; `splitLanes` never lets a
 *        booking into the live list
 */
import { describe, expect, it } from "vitest";

import {
  compareQueue,
  isLiveLane,
  queuedMs,
  splitLanes,
  type QueueOrderable,
} from "@/lib/queue-ordering";

const T0 = new Date("2026-07-03T09:00:00.000Z").getTime();
const MIN = 60_000;

function walkin(
  id: string,
  joinedAtMs: number,
  over: Partial<QueueOrderable> = {},
): QueueOrderable & { id: string } {
  return {
    id,
    channel: "WALKIN",
    date: new Date(joinedAtMs),
    queuedAt: new Date(joinedAtMs),
    queuePriority: 0,
    ticketSeq: null,
    ...over,
  };
}

function booking(
  id: string,
  slotMs: number,
  over: Partial<QueueOrderable> = {},
): QueueOrderable & { id: string } {
  return {
    id,
    channel: "PHONE",
    date: new Date(slotMs),
    queuedAt: null,
    queuePriority: 0,
    ticketSeq: null,
    ...over,
  };
}

function order(rows: Array<QueueOrderable & { id: string }>): string[] {
  return [...rows].sort(compareQueue).map((r) => r.id);
}

describe("queuedMs — the FIFO key", () => {
  it("uses queuedAt when present", () => {
    expect(queuedMs({ date: new Date(T0), queuedAt: new Date(T0 + 5 * MIN) })).toBe(
      T0 + 5 * MIN,
    );
  });

  it("falls back to date for legacy rows without queuedAt", () => {
    expect(queuedMs({ date: new Date(T0), queuedAt: null })).toBe(T0);
  });

  it("accepts Date, ISO string, and epoch interchangeably", () => {
    const iso = new Date(T0).toISOString();
    expect(queuedMs({ date: iso, queuedAt: iso })).toBe(T0);
    expect(queuedMs({ date: T0, queuedAt: T0 })).toBe(T0);
  });
});

describe("compareQueue — timeless FIFO", () => {
  it("orders strictly by arrival, not by slot time (I1)", () => {
    // w_late's row `date` (slot axis) is far in the future — irrelevant: it
    // joined the queue first, it is served first.
    const wLate = walkin("w_late", T0, { date: new Date(T0 + 6 * 60 * MIN) });
    const wEarly = walkin("w_early", T0 + 10 * MIN, { date: new Date(T0) });
    expect(order([wEarly, wLate])).toEqual(["w_late", "w_early"]);
  });

  it("urgency bump outranks earlier arrival", () => {
    const first = walkin("first", T0);
    const urgent = walkin("urgent", T0 + 30 * MIN, { queuePriority: 1 });
    expect(order([first, urgent])).toEqual(["urgent", "first"]);
  });

  it("equal arrival resolves by immutable ticketSeq", () => {
    const a = walkin("a", T0, { ticketSeq: 2 });
    const b = walkin("b", T0, { ticketSeq: 1 });
    expect(order([a, b])).toEqual(["b", "a"]);
  });

  it("ticketSeq falls back to queueOrder, missing both sorts last", () => {
    const seq = walkin("seq", T0, { ticketSeq: 1 });
    const ord = walkin("ord", T0, { ticketSeq: null, queueOrder: 2 });
    const bare = walkin("bare", T0, { ticketSeq: null, queueOrder: null });
    expect(order([bare, ord, seq])).toEqual(["seq", "ord", "bare"]);
  });
});

describe("lanes (I2)", () => {
  it("isLiveLane: only WALKIN is the live lane", () => {
    expect(isLiveLane({ channel: "WALKIN" })).toBe(true);
    for (const channel of ["PHONE", "TELEGRAM", "WEBSITE", "KIOSK"]) {
      expect(isLiveLane({ channel })).toBe(false);
    }
  });

  it("splitLanes: bookings never enter the live list, whatever their state", () => {
    // An "arrived" booking (checked in: queuedAt stamped, even earlier than
    // every walk-in) still belongs to the schedule lane.
    const arrivedBooking = booking("b_arrived", T0 + 60 * MIN, {
      queuedAt: new Date(T0 - 30 * MIN),
    });
    const w1 = walkin("w1", T0);
    const w2 = walkin("w2", T0 + 5 * MIN);
    const { live, schedule } = splitLanes([arrivedBooking, w2, w1]);
    expect(live.map((r) => r.id)).toEqual(["w1", "w2"]);
    expect(schedule.map((r) => r.id)).toEqual(["b_arrived"]);
  });

  it("splitLanes returns the live lane already FIFO-sorted", () => {
    const rows = [
      walkin("w3", T0 + 20 * MIN),
      walkin("w1", T0),
      walkin("w2", T0 + 10 * MIN, { queuePriority: 1 }),
    ];
    const { live } = splitLanes(rows);
    expect(live.map((r) => r.id)).toEqual(["w2", "w1", "w3"]);
  });

  it("a 13:00 booking and a 13:00 walk-in coexist without interaction", () => {
    // The strategy's core scenario: a booked 13:00 slot neither blocks nor
    // reorders a walk-in who joins the live queue at 13:00 — the two rows
    // live on independent axes.
    const slot13 = T0 + 4 * 60 * MIN;
    const b = booking("b_13", slot13);
    const w = walkin("w_13", slot13);
    const { live, schedule } = splitLanes([b, w]);
    expect(live.map((r) => r.id)).toEqual(["w_13"]);
    expect(schedule.map((r) => r.id)).toEqual(["b_13"]);
  });
});
