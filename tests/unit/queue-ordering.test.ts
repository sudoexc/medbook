/**
 * serveAt EDF model — `src/lib/queue-ordering.ts`
 *
 * The single source of truth for live-queue ordering, shared verbatim by the
 * server projection (TV board / kiosk / patient ticket) and every client sort
 * site (reception panel, doctor list, queue column). These tests pin the two
 * invariants the whole feature rests on:
 *
 *   - serveAt: a walk-in is served by arrival (`queuedAt`); a booking by
 *     max(slot, queuedAt) — so a late booking is treated as a walk-in from the
 *     moment it actually arrived and can't reclaim its original slot.
 *   - compareQueue: queuePriority (срочно) → serveAt (EDF) → ticketSeq.
 */
import { describe, it, expect } from "vitest";

import {
  serveAtMs,
  compareQueue,
  type QueueOrderable,
} from "@/lib/queue-ordering";

const at = (hhmm: string) => `2026-06-26T${hhmm}:00.000Z`;
const ms = (hhmm: string) => new Date(at(hhmm)).getTime();

function make(o: {
  priority?: number;
  channel?: string;
  date: string;
  queuedAt?: string | null;
  ticketSeq?: number | null;
  queueOrder?: number | null;
}): QueueOrderable {
  return {
    queuePriority: o.priority ?? 0,
    channel: o.channel ?? "PHONE",
    date: at(o.date),
    queuedAt: o.queuedAt == null ? null : at(o.queuedAt),
    ticketSeq: o.ticketSeq ?? null,
    queueOrder: o.queueOrder ?? null,
  };
}

describe("serveAtMs", () => {
  it("walk-in is served by arrival (queuedAt), not its display date", () => {
    const r = serveAtMs({
      channel: "WALKIN",
      date: at("09:00"),
      queuedAt: at("09:30"),
    });
    expect(r).toBe(ms("09:30"));
  });

  it("on-time booking is served at its slot, not its earlier arrival", () => {
    // Patient arrived 08:55 for a 09:00 slot — keeps the 09:00 deadline.
    const r = serveAtMs({
      channel: "PHONE",
      date: at("09:00"),
      queuedAt: at("08:55"),
    });
    expect(r).toBe(ms("09:00"));
  });

  it("late booking is served from arrival (treated as a walk-in)", () => {
    // 09:00 slot, but the patient only checked in at 09:40.
    const r = serveAtMs({
      channel: "PHONE",
      date: at("09:00"),
      queuedAt: at("09:40"),
    });
    expect(r).toBe(ms("09:40"));
  });

  it("falls back to date when queuedAt is null (pre-migration / not yet queued)", () => {
    const r = serveAtMs({
      channel: "TELEGRAM",
      date: at("09:00"),
      queuedAt: null,
    });
    expect(r).toBe(ms("09:00"));
  });

  it("accepts Date and epoch-ms as well as ISO strings", () => {
    const asDate = serveAtMs({
      channel: "WALKIN",
      date: new Date(at("09:00")),
      queuedAt: new Date(at("09:10")),
    });
    const asEpoch = serveAtMs({
      channel: "WALKIN",
      date: ms("09:00"),
      queuedAt: ms("09:10"),
    });
    expect(asDate).toBe(ms("09:10"));
    expect(asEpoch).toBe(ms("09:10"));
  });
});

describe("compareQueue", () => {
  const sorted = (rows: QueueOrderable[]) => [...rows].sort(compareQueue);

  it("urgency (queuePriority) beats an earlier serveAt", () => {
    const urgent = make({ priority: 1, date: "10:00", queuedAt: "10:00", ticketSeq: 9 });
    const early = make({ priority: 0, date: "09:00", queuedAt: "09:00", ticketSeq: 1 });
    expect(compareQueue(urgent, early)).toBeLessThan(0);
    expect(sorted([early, urgent])).toEqual([urgent, early]);
  });

  it("within a priority band, earlier serveAt is served first (EDF)", () => {
    const a = make({ date: "09:15", queuedAt: "09:15", ticketSeq: 2 });
    const b = make({ date: "09:05", queuedAt: "09:05", ticketSeq: 5 });
    expect(sorted([a, b])).toEqual([b, a]);
  });

  it("a late booking cannot jump a walk-in who actually waited", () => {
    // Booking slotted 09:00 but only arrived at 10:00.
    const lateBooking = make({
      channel: "PHONE",
      date: "09:00",
      queuedAt: "10:00",
      ticketSeq: 1,
    });
    // Walk-in arrived 09:30 — before the booking showed up.
    const walkin = make({
      channel: "WALKIN",
      date: "09:30",
      queuedAt: "09:30",
      ticketSeq: 7,
    });
    expect(sorted([lateBooking, walkin])).toEqual([walkin, lateBooking]);
  });

  it("an on-time booking keeps its place over a later walk-in", () => {
    const booking = make({
      channel: "PHONE",
      date: "09:00",
      queuedAt: "08:55",
      ticketSeq: 3,
    });
    const walkin = make({
      channel: "WALKIN",
      date: "09:15",
      queuedAt: "09:15",
      ticketSeq: 4,
    });
    expect(sorted([walkin, booking])).toEqual([booking, walkin]);
  });

  it("breaks an exact serveAt tie by immutable ticketSeq", () => {
    const later = make({ date: "09:00", queuedAt: "09:00", ticketSeq: 8 });
    const earlier = make({ date: "09:00", queuedAt: "09:00", ticketSeq: 2 });
    expect(sorted([later, earlier])).toEqual([earlier, later]);
  });

  it("falls back to queueOrder when ticketSeq is absent", () => {
    const later = make({ date: "09:00", queuedAt: "09:00", ticketSeq: null, queueOrder: 6 });
    const earlier = make({ date: "09:00", queuedAt: "09:00", ticketSeq: null, queueOrder: 1 });
    expect(sorted([later, earlier])).toEqual([earlier, later]);
  });
});
