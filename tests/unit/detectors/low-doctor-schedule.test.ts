/**
 * Tests for the LOW_DOCTOR_SCHEDULE detector.
 *
 * Verifies:
 *   - empty input → empty array
 *   - doctor with too few hours scheduled → one payload
 *   - doctor with sufficient schedule → suppressed
 *   - doctor fully on time-off → suppressed
 *   - dedupe — repeated runs yield identical payloads
 *   - shifts and leave are matched on Tashkent days and wall clock (AC-20)
 */
import { describe, it, expect } from "vitest";

import { detectLowDoctorSchedule } from "@/server/actions/detectors/low-doctor-schedule";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { dedupeKeyFor } from "@/lib/actions/types";

type Doctor = { id: string; nameRu: string; isActive: boolean };
type Schedule = {
  doctorId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom: Date | null;
  validTo: Date | null;
  isActive: boolean;
};
type TimeOff = { doctorId: string; startAt: Date; endAt: Date };

function makePrisma(state: {
  doctors: Doctor[];
  schedules: Schedule[];
  timeOffs: TimeOff[];
}) {
  return {
    doctor: { findMany: async () => state.doctors },
    doctorSchedule: { findMany: async () => state.schedules },
    doctorTimeOff: { findMany: async () => state.timeOffs },
  } as never;
}

const now = new Date("2026-05-06T08:00:00.000Z"); // Wed
const dayMs = 24 * 60 * 60 * 1000;

describe("detectLowDoctorSchedule", () => {
  it("returns [] when no active doctors", async () => {
    const out = await detectLowDoctorSchedule(
      makePrisma({ doctors: [], schedules: [], timeOffs: [] }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("emits payload for doctor with no schedule rows (slots=0)", async () => {
    const out = await detectLowDoctorSchedule(
      makePrisma({
        doctors: [{ id: "d1", nameRu: "Иванов", isActive: true }],
        schedules: [],
        timeOffs: [],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.doctorId).toBe("d1");
    expect(out[0]?.slotsNext7Days).toBe(0);
  });

  it("suppresses doctor with sufficient schedule", async () => {
    // 7 weekdays * 4 hours = 28 hours = 28 slots — well above default 5.
    const schedules: Schedule[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      schedules.push({
        doctorId: "d1",
        weekday,
        startTime: "10:00",
        endTime: "14:00",
        validFrom: null,
        validTo: null,
        isActive: true,
      });
    }
    const out = await detectLowDoctorSchedule(
      makePrisma({
        doctors: [{ id: "d1", nameRu: "Иванов", isActive: true }],
        schedules,
        timeOffs: [],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("suppresses doctor on full-window time-off", async () => {
    const start = new Date(now.getTime() - 1 * dayMs);
    const end = new Date(now.getTime() + 30 * dayMs);
    const out = await detectLowDoctorSchedule(
      makePrisma({
        doctors: [{ id: "d1", nameRu: "Иванов", isActive: true }],
        schedules: [],
        timeOffs: [{ doctorId: "d1", startAt: start, endAt: end }],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("dedupe — repeated runs yield identical payloads", async () => {
    const state = {
      doctors: [{ id: "d1", nameRu: "Иванов", isActive: true }],
      schedules: [],
      timeOffs: [],
    };
    const a = await detectLowDoctorSchedule(
      makePrisma(state),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    const b = await detectLowDoctorSchedule(
      makePrisma(state),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(a).toEqual(b);
    expect(dedupeKeyFor(a[0]!)).toBe(dedupeKeyFor(b[0]!));
  });

  describe("Tashkent days and wall clock (audit AC-20)", () => {
    // A high threshold so the payload always comes back with the count.
    const countAll = { ...DEFAULT_CONFIG, lowScheduleSlotsThreshold: 1000 };
    const doctors = [{ id: "d1", nameRu: "Иванов", isActive: true }];
    function weekdays(
      days: number[],
      startTime: string,
      endTime: string,
      extra: Partial<Schedule> = {},
    ): Schedule[] {
      return days.map((weekday) => ({
        doctorId: "d1",
        weekday,
        startTime,
        endTime,
        validFrom: null,
        validTo: null,
        isActive: true,
        ...extra,
      }));
    }
    async function slotsFor(schedules: Schedule[], timeOffs: TimeOff[] = []) {
      const out = await detectLowDoctorSchedule(
        makePrisma({ doctors, schedules, timeOffs }),
        "c1",
        now,
        countAll,
      );
      return out[0]?.slotsNext7Days;
    }

    it("counts the window Wed 6 .. Tue 12 May on Tashkent weekdays", async () => {
      // Mon..Fri 09:00-13:00: Wed, Thu, Fri, Mon, Tue = 5 days * 4h.
      expect(await slotsFor(weekdays([1, 2, 3, 4, 5], "09:00", "13:00"))).toBe(20);
    });

    it("leave on Wed..Fri cuts exactly those days' shifts", async () => {
      const leave: TimeOff = {
        doctorId: "d1",
        startAt: new Date("2026-05-06T00:00:00+05:00"),
        endAt: new Date("2026-05-09T00:00:00+05:00"),
      };
      expect(
        await slotsFor(weekdays([1, 2, 3, 4, 5], "09:00", "13:00"), [leave]),
      ).toBe(8);
    });

    it("a morning off on Thursday removes the morning shift, not a UTC one", async () => {
      // 09:00-13:00 Tashkent = 04:00-08:00Z. With shifts anchored at UTC
      // hours (09:00Z-13:00Z) this leave missed the shift entirely.
      const morningOff: TimeOff = {
        doctorId: "d1",
        startAt: new Date("2026-05-07T09:00:00+05:00"),
        endAt: new Date("2026-05-07T13:00:00+05:00"),
      };
      expect(
        await slotsFor(weekdays([1, 2, 3, 4, 5], "09:00", "13:00"), [morningOff]),
      ).toBe(16);
    });

    it("a schedule valid from next Tuesday counts that Tuesday", async () => {
      // Tuesday only, starting 12 May: the last day of the window. Reading
      // the weekday from 19:00Z walked Tue 5 .. Mon 11 and found nothing.
      const rows = weekdays([2], "09:00", "13:00", {
        validFrom: new Date("2026-05-12T00:00:00+05:00"),
      });
      expect(await slotsFor(rows)).toBe(4);
    });
  });
});
