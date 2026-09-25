import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit AP-01: a doctor's day off was bookable. The schedule editor stores
 * only working intervals, so a day off is a weekday with no rows, but slot
 * generation fell back to 09:00–19:00 whenever THAT weekday had no rows and
 * the booking check only ran when rows existed. A Mon–Fri neurologist was
 * bookable on Sunday from the Mini App and the CRM.
 *
 * Now: no schedule at all → the historical 09:00–19:00; any schedule → a
 * weekday without rows (or outside validFrom/validTo) is a day off.
 */

const db = vi.hoisted(() => ({
  schedules: [] as Array<{
    weekday: number;
    startTime: string;
    endTime: string;
    validFrom: Date | null;
    validTo: Date | null;
  }>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctorSchedule: { findMany: vi.fn(async () => db.schedules) },
    appointment: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    doctorTimeOff: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
  },
}));

import {
  isLeadDayOpen,
  workingWindowsFor,
} from "@/lib/doctor-working-windows";
import { toTashkentDate } from "@/lib/booking-validation";
import {
  detectConflicts,
  findAvailableSlots,
} from "@/server/services/appointments";

const MON_FRI = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startTime: "09:00",
  endTime: "18:00",
  validFrom: null,
  validTo: null,
}));

// Friday 25 Sep 2026, 08:00 Tashkent. Sunday = 27th, Monday = 28th.
const NOW = new Date("2026-09-25T03:00:00.000Z");
const SUNDAY = "2026-09-27";
const MONDAY = "2026-09-28";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db.schedules = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("workingWindowsFor", () => {
  it("a weekday without rows is a day off once the doctor has a schedule", () => {
    expect(workingWindowsFor(MON_FRI, SUNDAY)).toEqual([]);
    expect(workingWindowsFor(MON_FRI, MONDAY)).toEqual([
      { start: "09:00", end: "18:00" },
    ]);
  });

  it("a doctor with no schedule at all keeps 09:00–19:00 every day", () => {
    expect(workingWindowsFor([], SUNDAY)).toEqual([{ start: "09:00", end: "19:00" }]);
  });

  it("honours validFrom / validTo (inclusive days)", () => {
    const row = {
      weekday: 1,
      startTime: "10:00",
      endTime: "14:00",
      validFrom: "2026-10-05T00:00:00.000Z",
      validTo: "2026-10-12T00:00:00.000Z",
    };
    expect(workingWindowsFor([row], MONDAY)).toEqual([]); // before validFrom
    expect(workingWindowsFor([row], "2026-10-05")).toHaveLength(1);
    expect(workingWindowsFor([row], "2026-10-12")).toHaveLength(1); // last day
    expect(workingWindowsFor([row], "2026-10-19")).toEqual([]); // expired
  });

  it("orders split shifts by start", () => {
    const rows = [
      { weekday: 1, startTime: "14:00", endTime: "18:00" },
      { weekday: 1, startTime: "09:00", endTime: "12:00" },
    ];
    expect(workingWindowsFor(rows, MONDAY).map((w) => w.start)).toEqual([
      "09:00",
      "14:00",
    ]);
  });
});

describe("findAvailableSlots", () => {
  it("Mon–Fri doctor: no slots on Sunday, slots on Monday", async () => {
    db.schedules = MON_FRI;
    expect(
      await findAvailableSlots({ doctorId: "d1", date: toTashkentDate(SUNDAY, "12:00") }),
    ).toEqual([]);
    const monday = await findAvailableSlots({
      doctorId: "d1",
      date: toTashkentDate(MONDAY, "12:00"),
    });
    expect(monday[0]).toBe("09:00");
    expect(monday.at(-1)).toBe("17:40");
  });

  it("a doctor without a schedule keeps the old 09:00–19:00 slots", async () => {
    const sunday = await findAvailableSlots({
      doctorId: "d1",
      date: toTashkentDate(SUNDAY, "12:00"),
    });
    expect(sunday[0]).toBe("09:00");
    expect(sunday.at(-1)).toBe("18:40");
  });
});

describe("detectConflicts — booking validation", () => {
  const at = (date: string, time: string, min = 20) => {
    const startAt = toTashkentDate(date, time);
    return { startAt, endAt: new Date(startAt.getTime() + min * 60_000) };
  };

  it("Mon–Fri doctor: Sunday 10:00 is outside_schedule", async () => {
    db.schedules = MON_FRI;
    expect(await detectConflicts({ doctorId: "d1", ...at(SUNDAY, "10:00") })).toEqual({
      ok: false,
      reason: "outside_schedule",
    });
  });

  it("Mon–Fri doctor: Monday 10:00 is fine, Monday 18:30 is not", async () => {
    db.schedules = MON_FRI;
    expect(await detectConflicts({ doctorId: "d1", ...at(MONDAY, "10:00") })).toEqual({
      ok: true,
    });
    expect(await detectConflicts({ doctorId: "d1", ...at(MONDAY, "18:30") })).toEqual({
      ok: false,
      reason: "outside_schedule",
    });
  });

  it("a doctor without any schedule stays unconstrained, as before", async () => {
    expect(await detectConflicts({ doctorId: "d1", ...at(SUNDAY, "20:00") })).toEqual({
      ok: true,
    });
  });
});

describe("public lead form days", () => {
  it("greys out the chosen doctor's days off; without a schedule only Sunday", () => {
    const schedule = MON_FRI.map((r) => ({ ...r, validFrom: null, validTo: null }));
    expect(isLeadDayOpen(SUNDAY, schedule)).toBe(false);
    expect(isLeadDayOpen("2026-09-26", schedule)).toBe(false); // Saturday
    expect(isLeadDayOpen(MONDAY, schedule)).toBe(true);
    expect(isLeadDayOpen("2026-09-26", [])).toBe(true);
    expect(isLeadDayOpen(SUNDAY, undefined)).toBe(false);
  });
});
