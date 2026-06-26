/**
 * `allocateQueueOrder` unit coverage.
 *
 * The allocator is the integrity core of the live queue: it reads the current
 * per-doctor-per-day max queueOrder and returns max+1. These tests pin the
 * contract (1-based, empty → 1) and the WHERE shape (Tashkent day window +
 * the occupying-statuses filter) so a future refactor can't silently widen
 * the window or drop COMPLETED from the count.
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
    queueStatus: { in: string[] };
  };
  _max: { queueOrder: true };
};

function txWithMax(maxOrder: number | null) {
  const aggregate = vi.fn(async (_args: AggregateArgs) => ({
    _max: { queueOrder: maxOrder },
  }));
  return { tx: { appointment: { aggregate } } as never, aggregate };
}

describe("allocateQueueOrder", () => {
  it("empty queue → 1 (1-based)", async () => {
    const { tx } = txWithMax(null);
    const order = await allocateQueueOrder(tx, {
      clinicId: "c1",
      doctorId: "d1",
    });
    expect(order).toBe(1);
  });

  it("returns current max + 1", async () => {
    const { tx } = txWithMax(7);
    const order = await allocateQueueOrder(tx, {
      clinicId: "c1",
      doctorId: "d1",
    });
    expect(order).toBe(8);
  });

  it("scopes the read to clinic, doctor, the occupying statuses, and the Tashkent day window", async () => {
    const at = new Date("2026-06-25T09:00:00+05:00");
    const { tx, aggregate } = txWithMax(3);
    await allocateQueueOrder(tx, { clinicId: "c1", doctorId: "d1", at });

    expect(aggregate).toHaveBeenCalledTimes(1);
    const args = aggregate.mock.calls[0][0] as AggregateArgs;
    expect(args.where.clinicId).toBe("c1");
    expect(args.where.doctorId).toBe("d1");
    expect(args.where.queueStatus.in).toEqual([...QUEUE_OCCUPYING_STATUSES]);

    const { dayStart, dayEnd } = tashkentDayBounds(at);
    expect(args.where.date.gte.getTime()).toBe(dayStart.getTime());
    expect(args.where.date.lt.getTime()).toBe(dayEnd.getTime());
  });

  it("COMPLETED stays counted so a finished number is never re-issued", () => {
    expect(QUEUE_OCCUPYING_STATUSES).toContain("COMPLETED");
  });
});
