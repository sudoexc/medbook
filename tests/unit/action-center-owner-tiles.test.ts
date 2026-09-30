/**
 * Audit AC-15 / AC-11 — the Action Center's owner tiles read real, bounded
 * data.
 *
 *   - «Загрузка врачей» divided each doctor's count of today's rows
 *     (cancelled ones included) by a fixed 16, for the first five doctors.
 *     Now: booked minutes of visits that hold the doctor's time, against the
 *     working minutes the schedule gives them today; no percentage without
 *     working time.
 *   - Working time (`workingIntervalsOn`) honours the schedule's validity
 *     range and every time off, the rule the free-slot detector and the
 *     sidebar load now share.
 */
import { describe, expect, it } from "vitest";

import { computeDoctorsLoad } from "@/server/actions/doctors-load";
import {
  workingIntervalsOn,
  workingMinutesOn,
} from "@/lib/doctor-working-windows";

// 2026-09-30 is a Wednesday (weekday 3).
const DAY = "2026-09-30";
const WED = 3;

/** Tashkent wall clock of that day as an instant. */
function at(hhmm: string): Date {
  return new Date(`${DAY}T${hhmm}:00+05:00`);
}

describe("workingIntervalsOn", () => {
  const nineToSix = [{ weekday: WED, startTime: "09:00", endTime: "18:00" }];

  it("is the day's windows as instants", () => {
    expect(workingIntervalsOn(nineToSix, DAY)).toEqual([
      { start: at("09:00"), end: at("18:00") },
    ]);
    expect(workingMinutesOn(nineToSix, DAY)).toBe(9 * 60);
  });

  it("cuts out time off, whole or partial", () => {
    expect(
      workingIntervalsOn(nineToSix, DAY, [{ startAt: at("12:00"), endAt: at("13:00") }]),
    ).toEqual([
      { start: at("09:00"), end: at("12:00") },
      { start: at("13:00"), end: at("18:00") },
    ]);
    expect(
      workingMinutesOn(nineToSix, DAY, [
        { startAt: new Date("2026-09-28T00:00:00Z"), endAt: new Date("2026-10-05T00:00:00Z") },
      ]),
    ).toBe(0);
  });

  it("drops rows not valid on the day", () => {
    const ended = [{ ...nineToSix[0]!, validTo: new Date("2026-09-01T00:00:00Z") }];
    const later = [{ ...nineToSix[0]!, validFrom: new Date("2026-10-15T00:00:00Z") }];
    expect(workingMinutesOn(ended, DAY)).toBe(0);
    expect(workingMinutesOn(later, DAY)).toBe(0);
  });

  it("merges overlapping windows and gives no invented day without a schedule", () => {
    expect(
      workingMinutesOn(
        [
          { weekday: WED, startTime: "09:00", endTime: "13:00" },
          { weekday: WED, startTime: "12:00", endTime: "15:00" },
        ],
        DAY,
      ),
    ).toBe(6 * 60);
    // Slot pickers fall back to 09:00-19:00; capacity never does.
    expect(workingMinutesOn([], DAY)).toBe(0);
  });
});

describe("computeDoctorsLoad", () => {
  const doctor = (id: string, nameRu: string) => ({
    id,
    nameRu,
    nameUz: `${nameRu} uz`,
    specializationRu: "Невролог",
    specializationUz: "Nevrolog",
  });

  it("load is booked minutes against today's working minutes", () => {
    const [row] = computeDoctorsLoad({
      todayDate: DAY,
      doctors: [doctor("aziz", "Султанов Азиз")],
      schedules: [{ doctorId: "aziz", weekday: WED, startTime: "09:00", endTime: "17:00" }],
      timeOffs: [],
      appointments: Array.from({ length: 12 }, () => ({ doctorId: "aziz", durationMin: 30 })),
    });
    expect(row).toMatchObject({
      booked: 12,
      bookedMinutes: 360,
      workingMinutes: 480,
      loadPct: 75,
    });
  });

  it("shows every working or booked doctor, most loaded first, no cap of five", () => {
    const doctors = Array.from({ length: 7 }, (_, i) => doctor(`d${i}`, `Врач ${i}`));
    const rows = computeDoctorsLoad({
      todayDate: DAY,
      doctors,
      schedules: doctors.map((d) => ({
        doctorId: d.id,
        weekday: WED,
        startTime: "09:00",
        endTime: "13:00",
      })),
      timeOffs: [],
      appointments: [
        { doctorId: "d6", durationMin: 120 },
        { doctorId: "d2", durationMin: 60 },
      ],
    });
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ id: "d6", loadPct: 50 });
    expect(rows[1]).toMatchObject({ id: "d2", loadPct: 25 });
  });

  it("a doctor on leave with no bookings is left out; booked without a schedule has no %", () => {
    const rows = computeDoctorsLoad({
      todayDate: DAY,
      doctors: [doctor("away", "В отпуске"), doctor("free", "Без графика")],
      schedules: [{ doctorId: "away", weekday: WED, startTime: "09:00", endTime: "18:00" }],
      timeOffs: [
        {
          doctorId: "away",
          startAt: new Date("2026-09-29T00:00:00Z"),
          endAt: new Date("2026-10-03T00:00:00Z"),
        },
      ],
      appointments: [{ doctorId: "free", durationMin: 30 }],
    });
    expect(rows).toEqual([
      expect.objectContaining({ id: "free", booked: 1, workingMinutes: 0, loadPct: null }),
    ]);
  });
});
