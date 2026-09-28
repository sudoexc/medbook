/**
 * Audit AP-05: the free repeat window counts Tashkent calendar days.
 *
 * The service setting reads «if the patient comes back within N days, the
 * repeat visit is free». The engine compared milliseconds between the two
 * visit starts, so with N = 7 a first visit on Monday 10:00 and the repeat
 * on the next Monday at 15:00 (7 days 5 hours later) was billed in full,
 * while the audit meta said «day 7». Now the window compares the two visits'
 * days on the clinic's wall clock.
 *
 * Acceptance (the card): freeRepeatDays = 7, first visit Mon 10:00, the
 * repeat a week later Mon 15:00 is free; Tue 09:00 of the next week (day 8)
 * is paid.
 */
import { describe, expect, it, vi } from "vitest";

import {
  recomputeAppointmentPrice,
  tashkentCalendarDaysBetween,
  withinFreeRepeatWindow,
} from "@/server/pricing/recompute-appointment-price";

const CONSULT = { id: "svc_consult", priceBase: 300_000_00, freeRepeatDays: 7 };

// Mon 21.09.2026 10:00 in Tashkent (05:00 UTC).
const FIRST = new Date("2026-09-21T05:00:00.000Z");

type Visit = { id: string; date: Date; createdAt: Date };

/** A two-visit case over the real pricing engine; returns the repeat's result. */
async function priceRepeatAt(repeatAt: Date) {
  const visits: Visit[] = [
    { id: "first", date: FIRST, createdAt: FIRST },
    { id: "repeat", date: repeatAt, createdAt: FIRST },
  ];
  const update = vi.fn(async () => ({}));
  const client = {
    appointment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const v = visits.find((x) => x.id === where.id)!;
        return {
          id: v.id,
          date: v.date,
          medicalCaseId: "case_1",
          serviceId: CONSULT.id,
          priceService: CONSULT.priceBase,
          priceBase: CONSULT.priceBase,
          priceFinal: CONSULT.priceBase,
          discountPct: 0,
          discountAmount: 0,
          payments: [],
          services: [],
          primaryService: CONSULT,
        };
      }),
      findMany: vi.fn(async () =>
        [...visits]
          .sort((a, b) => a.date.getTime() - b.date.getTime())
          .map((v) => ({ id: v.id, date: v.date })),
      ),
      update,
    },
  };
  const result = await recomputeAppointmentPrice(client as never, "repeat");
  return { result, update };
}

describe("free repeat window in Tashkent calendar days (AP-05)", () => {
  it("next Monday 15:00 after a Monday 10:00 first visit is day 7 and free", async () => {
    // Mon 28.09.2026 15:00 Tashkent = 10:00 UTC: 7 days 5 hours later.
    const { result, update } = await priceRepeatAt(
      new Date("2026-09-28T10:00:00.000Z"),
    );
    expect(result.reason).toBe("free_repeat");
    expect(result.priceFinal).toBe(0);
    expect(result.daysFromFirst).toBe(7);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priceBase: 0, priceFinal: 0 }),
      }),
    );
  });

  it("the Tuesday after, even at 09:00, is day 8 and billed in full", async () => {
    // Tue 29.09.2026 09:00 Tashkent = 04:00 UTC.
    const { result } = await priceRepeatAt(new Date("2026-09-29T04:00:00.000Z"));
    expect(result.reason).toBe("normal");
    expect(result.priceFinal).toBe(CONSULT.priceBase);
    expect(result.daysFromFirst).toBe(8);
  });

  it("days are read on the clinic's clock, not UTC", () => {
    // 23:30 Tashkent on the 21st is still the 21st (18:30 UTC); 00:30 on the
    // 22nd is 19:30 UTC of the 21st. Only the clinic's day counts.
    const lateMonday = new Date("2026-09-21T18:30:00.000Z");
    const earlyTuesday = new Date("2026-09-21T19:30:00.000Z");
    expect(tashkentCalendarDaysBetween(FIRST, lateMonday)).toBe(0);
    expect(tashkentCalendarDaysBetween(FIRST, earlyTuesday)).toBe(1);
  });

  it("the window is inclusive of day N and never runs backwards", () => {
    const day7Late = new Date("2026-09-28T18:59:00.000Z"); // Mon 23:59
    const day8Early = new Date("2026-09-28T19:00:00.000Z"); // Tue 00:00
    expect(withinFreeRepeatWindow(FIRST, day7Late, 7)).toBe(true);
    expect(withinFreeRepeatWindow(FIRST, day8Early, 7)).toBe(false);
    expect(
      withinFreeRepeatWindow(FIRST, new Date(FIRST.getTime() - 60_000), 7),
    ).toBe(false);
  });
});
