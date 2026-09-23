/**
 * `allocateQueueOrder` unit coverage.
 *
 * The allocator is the integrity core of the live queue. It hands out two
 * numbers per doctor per day:
 *   - `queueOrder` — max over the OCCUPYING rows + 1 (a cancelled visit
 *     frees its ordering slot);
 *   - `ticketSeq` — max over EVERY row of the day + 1 (a printed ticket is
 *     burned for good, cancelled or not).
 * These tests pin both contracts (1-based, empty → 1), the WHERE shapes
 * (Tashkent day window + the occupying-statuses filter) and the rule the
 * clinic hit in practice: removing C-003 from the queue must not hand
 * «C-003» to the next arrival.
 */
import { describe, it, expect, vi } from "vitest";

import {
  allocateQueueOrder,
  QUEUE_OCCUPYING_STATUSES,
} from "@/server/appointments/queue-order";
import { tashkentDayBounds } from "@/lib/booking-validation";

type AggregateArgs = {
  where: {
    clinicId: string;
    doctorId: string;
    date: { gte: Date; lt: Date };
    queueStatus?: { in: string[] };
  };
  _max: { queueOrder?: true; ticketSeq?: true };
};

type Row = {
  queueStatus: string;
  queueOrder: number | null;
  ticketSeq: number | null;
};

/** Answers both aggregates from an in-memory day of rows. */
function txWithRows(rows: Row[]) {
  const aggregate = vi.fn(async (args: AggregateArgs) => {
    const pool = args.where.queueStatus
      ? rows.filter((r) => args.where.queueStatus!.in.includes(r.queueStatus))
      : rows;
    const max = (pick: (r: Row) => number | null) => {
      const values = pool.map(pick).filter((v): v is number => v !== null);
      return values.length ? Math.max(...values) : null;
    };
    return {
      _max: {
        queueOrder: max((r) => r.queueOrder),
        ...(args._max.ticketSeq ? { ticketSeq: max((r) => r.ticketSeq) } : {}),
      },
    };
  });
  return { tx: { appointment: { aggregate } } as never, aggregate };
}

const row = (
  queueStatus: string,
  queueOrder: number | null,
  ticketSeq: number | null = queueOrder,
): Row => ({ queueStatus, queueOrder, ticketSeq });

describe("allocateQueueOrder", () => {
  it("empty queue → 1 / 1 (1-based)", async () => {
    const { tx } = txWithRows([]);
    const next = await allocateQueueOrder(tx, {
      clinicId: "c1",
      doctorId: "d1",
    });
    expect(next).toEqual({ queueOrder: 1, ticketSeq: 1 });
  });

  it("returns current max + 1 for both numbers", async () => {
    const { tx } = txWithRows([row("WAITING", 7), row("COMPLETED", 6)]);
    const next = await allocateQueueOrder(tx, {
      clinicId: "c1",
      doctorId: "d1",
    });
    expect(next).toEqual({ queueOrder: 8, ticketSeq: 8 });
  });

  it("never re-issues the ticket number of a cancelled visit", async () => {
    // C-003 was removed from the queue; the patient still holds the slip.
    const { tx } = txWithRows([
      row("COMPLETED", 1),
      row("WAITING", 2),
      row("CANCELLED", 3),
    ]);
    const next = await allocateQueueOrder(tx, {
      clinicId: "c1",
      doctorId: "d1",
    });
    expect(next.ticketSeq).toBe(4);
    // The ordering slot, on the other hand, is free again.
    expect(next.queueOrder).toBe(3);
  });

  it("watermarks over queueOrder for rows that predate ticketSeq", async () => {
    const { tx } = txWithRows([row("CANCELLED", 5, null)]);
    const next = await allocateQueueOrder(tx, {
      clinicId: "c1",
      doctorId: "d1",
    });
    expect(next.ticketSeq).toBe(6);
  });

  it("scopes both reads to clinic, doctor and the Tashkent day window; only the slot read filters by status", async () => {
    const at = new Date("2026-06-25T09:00:00+05:00");
    const { tx, aggregate } = txWithRows([row("WAITING", 3)]);
    await allocateQueueOrder(tx, { clinicId: "c1", doctorId: "d1", at });

    expect(aggregate).toHaveBeenCalledTimes(2);
    const calls = aggregate.mock.calls.map((c) => c[0] as AggregateArgs);
    const { dayStart, dayEnd } = tashkentDayBounds(at);
    for (const args of calls) {
      expect(args.where.clinicId).toBe("c1");
      expect(args.where.doctorId).toBe("d1");
      expect(args.where.date.gte.getTime()).toBe(dayStart.getTime());
      expect(args.where.date.lt.getTime()).toBe(dayEnd.getTime());
    }
    const slotRead = calls.find((a) => a.where.queueStatus);
    const ticketRead = calls.find((a) => !a.where.queueStatus);
    expect(slotRead?.where.queueStatus?.in).toEqual([
      ...QUEUE_OCCUPYING_STATUSES,
    ]);
    expect(ticketRead?._max.ticketSeq).toBe(true);
  });

  it("COMPLETED stays counted so a finished number is never re-issued", () => {
    expect(QUEUE_OCCUPYING_STATUSES).toContain("COMPLETED");
  });
});
