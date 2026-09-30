/**
 * Audit DR-08: the doctors page stops inventing its day.
 *
 * Capacity was a fixed 10 visits and 09:00-18:00 for everyone, every
 * booking counted 30 minutes (cancelled and missed ones too), a gap of an
 * hour read «Обед», «Ближайшее окно» could be 09:00 at 16:00, «Выручка
 * сегодня» showed the month, and «Потери» multiplied a made-up 150 000 сум
 * and showed tiins as thousands.
 *
 * Acceptance: a Mon–Fri doctor has no free window and no load on Saturday;
 * «Выручка сегодня» equals the completed visits of today; the load is
 * booked minutes over the schedule's minutes; the next free slot comes from
 * the booking calendar (never before now).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  computeDoctorsToday,
  visitRevenue,
  type TodayVisit,
} from "@/server/doctors/today";

/** Mon–Fri 09:00–13:00 and 14:00–18:00 (a real lunch break in the schedule). */
const SCHEDULE = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { doctorId: "doc_aziz", weekday, startTime: "09:00", endTime: "13:00" },
  { doctorId: "doc_aziz", weekday, startTime: "14:00", endTime: "18:00" },
]);

// Wednesday 30.09.2026, 11:15 Tashkent (UTC+5).
const WED = new Date("2026-09-30T06:15:00.000Z");
// Saturday 03.10.2026, 11:15 Tashkent.
const SAT = new Date("2026-10-03T06:15:00.000Z");

/** A visit at HH:MM Tashkent on 30.09. */
function at(hhmm: string, over: Partial<TodayVisit> = {}): TodayVisit {
  const [h, m] = hhmm.split(":").map(Number);
  return {
    doctorId: "doc_aziz",
    status: "CONFIRMED",
    date: new Date(Date.UTC(2026, 8, 30, h! - 5, m!)),
    durationMin: 30,
    priceFinal: 150_000_00,
    priceService: 150_000_00,
    discountAmount: 0,
    ...over,
  };
}

describe("computeDoctorsToday", () => {
  it("Saturday for a Mon–Fri doctor: no working time, no load, off shift", () => {
    const out = computeDoctorsToday({
      now: SAT,
      doctorIds: ["doc_aziz"],
      schedules: SCHEDULE,
      timeOffs: [],
      visits: [],
      nextFree: new Map([["doc_aziz", null]]),
    });
    expect(out.doctors[0]).toMatchObject({
      workingMinutes: 0,
      loadPct: null,
      status: "off",
      nextFree: null,
    });
    expect(out.clinic.loadPct).toBeNull();
  });

  it("load = booked minutes of live visits / the schedule's minutes", () => {
    const visits = [
      at("09:00", { status: "COMPLETED", durationMin: 40 }),
      at("10:00", { status: "IN_PROGRESS", durationMin: 60 }),
      at("15:00", { status: "CONFIRMED", durationMin: 20 }),
      // Neither holds the doctor's time.
      at("16:00", { status: "CANCELLED", durationMin: 60 }),
      at("17:00", { status: "NO_SHOW", durationMin: 60 }),
    ];
    const out = computeDoctorsToday({
      now: WED,
      doctorIds: ["doc_aziz"],
      schedules: SCHEDULE,
      timeOffs: [],
      visits,
      nextFree: new Map([["doc_aziz", "11:20"]]),
    });
    const row = out.doctors[0]!;
    expect(row.workingMinutes).toBe(480);
    expect(row.booked).toBe(3);
    expect(row.bookedMinutes).toBe(120);
    expect(row.loadPct).toBe(25);
    expect(row.status).toBe("busy");
    expect(row.nextFree).toBe("11:20");
    expect(out.clinic).toEqual({
      booked: 3,
      bookedMinutes: 120,
      workingMinutes: 480,
      loadPct: 25,
    });
  });

  it("revenue today = completed visits of today only", () => {
    const out = computeDoctorsToday({
      now: WED,
      doctorIds: ["doc_aziz"],
      schedules: SCHEDULE,
      timeOffs: [],
      visits: [
        at("09:00", { status: "COMPLETED", priceFinal: 150_000_00 }),
        // No final price written: service minus discount.
        at("09:30", {
          status: "COMPLETED",
          priceFinal: null,
          priceService: 200_000_00,
          discountAmount: 20_000_00,
        }),
        at("15:00", { status: "CONFIRMED", priceFinal: 150_000_00 }),
      ],
      nextFree: new Map(),
    });
    expect(out.doctors[0]!.revenueToday).toBe(330_000_00);
    expect(visitRevenue({ priceFinal: 0, priceService: 99, discountAmount: 0 })).toBe(0);
  });

  it("status: free inside working time, off during the schedule's own break", () => {
    const free = computeDoctorsToday({
      now: WED,
      doctorIds: ["doc_aziz"],
      schedules: SCHEDULE,
      timeOffs: [],
      visits: [],
      nextFree: new Map(),
    });
    expect(free.doctors[0]!.status).toBe("free");
    const lunch = computeDoctorsToday({
      now: new Date("2026-09-30T08:30:00.000Z"), // 13:30 Tashkent
      doctorIds: ["doc_aziz"],
      schedules: SCHEDULE,
      timeOffs: [],
      visits: [],
      nextFree: new Map(),
    });
    expect(lunch.doctors[0]!.status).toBe("off");
  });

  it("leave today: no working time, no load", () => {
    const out = computeDoctorsToday({
      now: WED,
      doctorIds: ["doc_aziz"],
      schedules: SCHEDULE,
      timeOffs: [
        {
          doctorId: "doc_aziz",
          startAt: new Date("2026-09-29T19:00:00.000Z"),
          endAt: new Date("2026-09-30T19:00:00.000Z"),
        },
      ],
      visits: [],
      nextFree: new Map(),
    });
    expect(out.doctors[0]).toMatchObject({ workingMinutes: 0, loadPct: null, status: "off" });
  });

  it("the heatmap hours carry working and booked minutes from the real day", () => {
    const out = computeDoctorsToday({
      now: WED,
      doctorIds: ["doc_aziz"],
      schedules: SCHEDULE,
      timeOffs: [],
      visits: [at("09:40", { durationMin: 40 })],
      nextFree: new Map(),
    });
    const hours = out.doctors[0]!.hours;
    expect(hours.map((h) => h.hour)).toEqual([9, 10, 11, 12, 14, 15, 16, 17]);
    expect(hours.find((h) => h.hour === 9)).toEqual({ hour: 9, workingMin: 60, bookedMin: 20 });
    expect(hours.find((h) => h.hour === 10)).toEqual({ hour: 10, workingMin: 60, bookedMin: 20 });
  });
});

describe("the page has no invented numbers left", () => {
  const read = (rel: string) =>
    readFileSync(
      path.resolve(__dirname, "../../src/app/[locale]/crm/doctors/_components", rel),
      "utf8",
    );

  it("no fixed capacity, hours, lunch or 150 000 fallback", () => {
    const page = read("doctors-page-client.tsx");
    expect(page).not.toMatch(/DAY_CAPACITY|WORKING_HOURS|deriveStatus/);
    const tiles = read("doctors-tiles.tsx");
    expect(tiles).not.toMatch(/150_000|\/ 1_000|todayCap|doctorsCount \* 10/);
    const card = read("doctor-card.tsx");
    expect(card).not.toContain("statusLunch");
    const heatmap = read("doctors-heatmap.tsx");
    expect(heatmap).not.toMatch(/perHourCapacity|slice\(0, 5\)/);
    const ai = read("doctors-ai-recommendations.tsx");
    expect(ai).not.toMatch(/dayCapacity|eveningTitle/);
  });
});
