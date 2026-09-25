/**
 * Audit G2-01 — seed-prod-demo.ts must be safe to point at the live clinic.
 *
 * The old script created 540 patients (header: 30), booked a new future
 * visit per patient on every run, placed visits at 14:00–22:00 Tashkent
 * (setHours on a UTC box), picked a random cabinet, used WALKIN for bookings,
 * left `time` empty and marked nothing. Pinned here: the planning helpers
 * and the script's own guards.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEMO_CHANNELS,
  DEMO_COUNT,
  DEMO_TAG,
  candidateSlots,
  demoPhone,
  slotsForDay,
  type ScheduleRow,
} from "../../scripts/_demo-seed-plan";
import { tashkentComponents } from "@/lib/booking-validation";

// Monday..Friday 09:00-17:00 (weekday: 0 = Sunday).
const WEEKDAYS: ScheduleRow[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startTime: "09:00",
  endTime: "17:00",
  isActive: true,
}));

describe("demo population", () => {
  it("is the 30 patients the header promises", () => {
    expect(DEMO_COUNT).toBe(30);
  });

  it("uses numbers no real patient can own (operator code 00), all distinct", () => {
    const phones = Array.from({ length: DEMO_COUNT }, (_, i) => demoPhone(i));
    expect(new Set(phones).size).toBe(DEMO_COUNT);
    for (const p of phones) expect(p).toMatch(/^\+99800\d{7}$/);
  });

  it("never books through the WALKIN live lane", () => {
    expect(DEMO_CHANNELS).not.toContain("WALKIN");
  });

  it("marks rows with a stable tag", () => {
    expect(DEMO_TAG).toBe("demo-seed");
  });
});

describe("slots sit inside the doctor's schedule, in Tashkent time", () => {
  it("a Monday 09:00-17:00 shift yields 09:00 Tashkent = 04:00 UTC, time filled", () => {
    const slots = slotsForDay(WEEKDAYS, "2026-09-28", 30);
    expect(slots[0].time).toBe("09:00");
    expect(slots[0].date.toISOString()).toBe("2026-09-28T04:00:00.000Z");
    const last = slots[slots.length - 1];
    expect(tashkentComponents(last.endDate).time <= "17:00").toBe(true);
    for (const s of slots) {
      const t = tashkentComponents(s.date);
      expect(t.time).toBe(s.time);
      expect(t.minutes).toBeGreaterThanOrEqual(9 * 60);
      expect(tashkentComponents(s.endDate).minutes).toBeLessThanOrEqual(17 * 60);
    }
  });

  it("no slots on a day the doctor does not work", () => {
    expect(slotsForDay(WEEKDAYS, "2026-09-27", 30)).toEqual([]); // Sunday
  });

  it("future candidates are after now and within a week; past ones ended before now", () => {
    const now = new Date("2026-09-25T09:00:00.000Z"); // Fri 14:00 Tashkent
    const future = candidateSlots({ kind: "future", schedules: WEEKDAYS, durationMin: 20, now });
    expect(future.length).toBeGreaterThan(0);
    for (const s of future) {
      expect(s.date.getTime()).toBeGreaterThan(now.getTime());
      expect(s.date.getTime() - now.getTime()).toBeLessThan(8 * 24 * 3600_000);
    }
    const past = candidateSlots({ kind: "past", schedules: WEEKDAYS, durationMin: 20, now });
    expect(past.length).toBeGreaterThan(0);
    for (const s of past) expect(s.endDate.getTime()).toBeLessThan(now.getTime());
  });
});

describe("the script itself", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../scripts/seed-prod-demo.ts"),
    "utf8",
  );

  it("is a dry run unless APPLY=1, and guards a clinic in real use", () => {
    expect(src).toMatch(/process\.env\.APPLY === "1"/);
    expect(src).toMatch(/assertDemoWriteAllowed\(/);
  });

  it("takes the doctor's own cabinet and fills time", () => {
    expect(src).toMatch(/cabinetId: doctor\.cabinetId/);
    expect(src).toMatch(/time: slot\.time/);
    expect(src).not.toMatch(/pick\(cabinets\)/);
    expect(src).not.toMatch(/setHours/);
  });

  it("only gives visits to demo patients that have none (re-run adds nothing)", () => {
    expect(src).toMatch(/appointment\.count\(/);
    expect(src).toMatch(/if \(any > 0\) continue;/);
  });

  it("no longer overwrites the clinic's notification templates", () => {
    expect(src).not.toMatch(/notificationTemplate\.upsert/);
  });

  it("marks patients, visits and payments", () => {
    expect(src).toMatch(/tags: \[DEMO_TAG\]/);
    expect(src).toMatch(/notes: DEMO_APPOINTMENT_NOTE/);
    expect(src).toMatch(/externalRef: DEMO_PAYMENT_REF/);
  });
});
