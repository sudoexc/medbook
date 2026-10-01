/**
 * Audit MA-14 / MA-17 — the frame a patient's own booking is held to.
 *
 *   - A start must be one the slot picker offers: inside the doctor's hours
 *     for that day, on the 20 minute grid counted from the window's start,
 *     and ending by the window's end. A doctor without a schedule keeps the
 *     09:00-19:00 day (detectConflicts checks no hours for him at all).
 *   - The horizon is the wizard's 14 Tashkent days, today included.
 *   - Days and slot instants are Tashkent ones whatever the phone's zone: a
 *     «10:00» picked in Moscow is 05:00Z, not 07:00Z.
 *   - A patient holds at most 3 booked visits ahead, 1 per doctor; visits
 *     already under way and live-queue tickets do not count.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { isOfferedSlotStart, slotOnWindowGrid } from "@/server/services/appointments";
import {
  bookingDayLabelDate,
  isWithinBookingHorizon,
  miniAppBookingDays,
  MINIAPP_BOOKING_HORIZON_DAYS,
  tashkentSlotStartIso,
} from "@/lib/appointments/patient-booking";
import { miniAppBookingLimitRefusal } from "@/server/miniapp/booking-limits";

const MON_9_TO_13 = [{ start: "09:00", end: "13:00" }];

describe("slotOnWindowGrid", () => {
  it("accepts the picker's starts and refuses the minutes between them", () => {
    expect(slotOnWindowGrid(MON_9_TO_13, 9 * 60, 30)).toBe(true);
    expect(slotOnWindowGrid(MON_9_TO_13, 9 * 60 + 20, 30)).toBe(true);
    expect(slotOnWindowGrid(MON_9_TO_13, 10 * 60 + 40, 30)).toBe(true);
    // 10:07 left 13 dead minutes on each side.
    expect(slotOnWindowGrid(MON_9_TO_13, 10 * 60 + 7, 30)).toBe(false);
    expect(slotOnWindowGrid(MON_9_TO_13, 10 * 60 + 30, 30)).toBe(false);
  });

  it("counts the grid from each window's own start", () => {
    const split = [
      { start: "09:00", end: "12:00" },
      { start: "14:10", end: "18:00" },
    ];
    expect(slotOnWindowGrid(split, 14 * 60 + 10, 30)).toBe(true);
    expect(slotOnWindowGrid(split, 14 * 60 + 30, 30)).toBe(true);
    expect(slotOnWindowGrid(split, 14 * 60, 30)).toBe(false);
  });

  it("refuses a start outside the hours or one that runs past their end", () => {
    expect(slotOnWindowGrid(MON_9_TO_13, 8 * 60 + 40, 30)).toBe(false);
    expect(slotOnWindowGrid(MON_9_TO_13, 12 * 60 + 40, 30)).toBe(false);
    expect(slotOnWindowGrid(MON_9_TO_13, 12 * 60 + 20, 40)).toBe(true);
    // Ten services in one booking cannot close the doctor's day.
    expect(slotOnWindowGrid(MON_9_TO_13, 9 * 60, 300)).toBe(false);
    // A day off has no window.
    expect(slotOnWindowGrid([], 10 * 60, 30)).toBe(false);
  });
});

describe("isOfferedSlotStart", () => {
  function client(rows: Array<Record<string, unknown>>) {
    return {
      doctorSchedule: { findMany: vi.fn(async () => rows) },
    } as never;
  }
  // Monday 5 Oct 2026; DoctorSchedule weekday 1.
  const monday = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00+05:00`);
  const schedule = [{ weekday: 1, startTime: "09:00", endTime: "13:00", validFrom: null, validTo: null }];

  it("reads the doctor's hours for that Tashkent day", async () => {
    const c = client(schedule);
    expect(await isOfferedSlotStart({ doctorId: "d1", startAt: monday("10:20"), durationMin: 30 }, c)).toBe(true);
    expect(await isOfferedSlotStart({ doctorId: "d1", startAt: monday("10:25"), durationMin: 30 }, c)).toBe(false);
    // Tuesday: no rows, a day off.
    const tuesday = new Date("2026-10-06T10:20:00+05:00");
    expect(await isOfferedSlotStart({ doctorId: "d1", startAt: tuesday, durationMin: 30 }, c)).toBe(false);
  });

  it("a doctor with no schedule is held to the picker's 09:00-19:00 day, not to 03:00", async () => {
    const c = client([]);
    expect(await isOfferedSlotStart({ doctorId: "d1", startAt: monday("18:20"), durationMin: 30 }, c)).toBe(true);
    expect(await isOfferedSlotStart({ doctorId: "d1", startAt: monday("03:00"), durationMin: 30 }, c)).toBe(false);
  });

  it("refuses seconds off the minute", async () => {
    const c = client(schedule);
    const odd = new Date(monday("10:20").getTime() + 15_000);
    expect(await isOfferedSlotStart({ doctorId: "d1", startAt: odd, durationMin: 30 }, c)).toBe(false);
  });
});

describe("booking horizon and Tashkent days", () => {
  const now = new Date("2026-10-01T20:30:00Z"); // 01:30 on 2 Oct in Tashkent

  it("the strip is 14 Tashkent days starting with the clinic's today", () => {
    const days = miniAppBookingDays(now);
    expect(days).toHaveLength(MINIAPP_BOOKING_HORIZON_DAYS);
    expect(days[0]).toBe("2026-10-02");
    expect(days[13]).toBe("2026-10-15");
  });

  it("a start on day 14 is in, day 15 and yesterday are out", () => {
    expect(isWithinBookingHorizon(new Date("2026-10-15T13:00:00Z"), now)).toBe(true);
    expect(isWithinBookingHorizon(new Date("2026-10-16T04:00:00Z"), now)).toBe(false);
    expect(isWithinBookingHorizon(new Date("2027-01-10T04:00:00Z"), now)).toBe(false);
    expect(isWithinBookingHorizon(new Date("2026-10-01T10:00:00Z"), now)).toBe(false);
  });

  describe("on a phone in Moscow", () => {
    const original = process.env.TZ;
    afterEach(() => {
      process.env.TZ = original;
    });

    it("the 10:00 slot is sent as 05:00Z (the old local build said 07:00Z)", () => {
      process.env.TZ = "Europe/Moscow";
      expect(tashkentSlotStartIso("2026-10-02", "10:00")).toBe("2026-10-02T05:00:00.000Z");
      // What the reschedule sheet used to send.
      expect(new Date(2026, 9, 2, 10, 0).toISOString()).toBe("2026-10-02T07:00:00.000Z");
    });

    it("a strip day keeps its own date and weekday", () => {
      process.env.TZ = "America/Los_Angeles";
      const d = bookingDayLabelDate("2026-10-05");
      expect(d.getUTCDate()).toBe(5);
      expect(d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })).toBe("Mon");
    });
  });
});

describe("miniAppBookingLimitRefusal", () => {
  const now = new Date("2026-10-01T05:00:00Z");
  function client(rows: Array<{ doctorId: string }>) {
    const findMany = vi.fn(async () => rows);
    return { c: { appointment: { findMany } } as never, findMany };
  }
  const args = { clinicId: "c1", patientId: "p_mama", doctorId: "d1", now };

  it("a 4th booked visit ahead is refused", async () => {
    const { c } = client([{ doctorId: "d2" }, { doctorId: "d3" }, { doctorId: "d4" }]);
    expect(await miniAppBookingLimitRefusal(c, args)).toEqual({
      reason: "booking_limit",
      limit: "patient_total",
    });
  });

  it("a second booked visit with the same doctor is refused", async () => {
    const { c } = client([{ doctorId: "d1" }]);
    expect(await miniAppBookingLimitRefusal(c, args)).toEqual({
      reason: "booking_limit",
      limit: "patient_doctor",
    });
  });

  it("two other bookings leave room for a third", async () => {
    const { c } = client([{ doctorId: "d2" }, { doctorId: "d3" }]);
    expect(await miniAppBookingLimitRefusal(c, args)).toBeNull();
  });

  it("counts only this patient's booked visits ahead, never live-queue tickets", async () => {
    const { c, findMany } = client([]);
    await miniAppBookingLimitRefusal(c, args);
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0]
      .where;
    expect(where).toMatchObject({
      clinicId: "c1",
      patientId: "p_mama",
      channel: { not: "WALKIN" },
    });
    const and = where.AND as Array<Record<string, unknown>>;
    // Queued or on the table: under way, not «ahead», so the doctor's
    // «запишитесь на контроль» can be booked from the hall.
    expect(and).toContainEqual({ status: { in: ["BOOKED", "CONFIRMED"] } });
  });
});
