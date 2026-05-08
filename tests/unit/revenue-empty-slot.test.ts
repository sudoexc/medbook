/**
 * Unit tests — Phase 14, Wave 2.
 *
 * Pure-function coverage for `computeEmptySlot` and the schedule-hour
 * expander. The DB-backed `snapshotEmptySlotsForDay` is exercised by the
 * Wave 3 integration tests (Prisma mocking would be more brittle than
 * useful at this layer).
 */
import { describe, it, expect } from "vitest";

import {
  computeEmptySlot,
  expandScheduleHours,
} from "@/server/revenue/empty-slot";

const date = new Date("2026-05-06T00:00:00.000Z");

describe("computeEmptySlot", () => {
  it("returns 0 lost when workingHours == bookedHours", () => {
    const r = computeEmptySlot({
      doctorId: "doc-1",
      date,
      workingHours: [9, 10, 11, 12],
      bookedHours: [9, 10, 11, 12],
      averageServicePriceUzs: 50_000_00, // 50_000 UZS in tiins
    });
    expect(r.emptyHours).toEqual([]);
    expect(r.estimatedRevenueLossUzs).toBe(0);
  });

  it("treats every working hour as lost when bookedHours is empty", () => {
    const r = computeEmptySlot({
      doctorId: "doc-1",
      date,
      workingHours: [9, 10, 11, 12],
      bookedHours: [],
      averageServicePriceUzs: 50_000_00,
    });
    expect(r.emptyHours).toEqual([9, 10, 11, 12]);
    expect(r.estimatedRevenueLossUzs).toBe(4 * 50_000_00);
  });

  it("computes setminus on partial overlap", () => {
    const r = computeEmptySlot({
      doctorId: "doc-1",
      date,
      workingHours: [9, 10, 11, 12, 13, 14],
      bookedHours: [10, 12],
      averageServicePriceUzs: 100_000_00,
    });
    expect(r.emptyHours).toEqual([9, 11, 13, 14]);
    expect(r.estimatedRevenueLossUzs).toBe(4 * 100_000_00);
  });

  it("returns 0 lost when workingHours is empty", () => {
    const r = computeEmptySlot({
      doctorId: "doc-1",
      date,
      workingHours: [],
      bookedHours: [9, 10],
      averageServicePriceUzs: 50_000_00,
    });
    expect(r.emptyHours).toEqual([]);
    expect(r.estimatedRevenueLossUzs).toBe(0);
  });

  it("revenue is len * avgPrice, integer (tiins, no floats)", () => {
    const r = computeEmptySlot({
      doctorId: "doc-1",
      date,
      workingHours: [8, 9, 10, 11, 12, 13, 14],
      bookedHours: [10],
      averageServicePriceUzs: 12_345_67, // 12345.67 UZS in tiins
    });
    expect(r.emptyHours.length).toBe(6);
    expect(r.estimatedRevenueLossUzs).toBe(6 * 12_345_67);
    expect(Number.isInteger(r.estimatedRevenueLossUzs)).toBe(true);
  });

  it("dedupes and sorts working/booked hours", () => {
    const r = computeEmptySlot({
      doctorId: "doc-1",
      date,
      workingHours: [10, 9, 9, 11, 11, 9],
      bookedHours: [10, 10],
      averageServicePriceUzs: 1000,
    });
    expect(r.emptyHours).toEqual([9, 11]);
    expect(r.estimatedRevenueLossUzs).toBe(2000);
  });

  it("ignores out-of-range hours and non-finite values", () => {
    const r = computeEmptySlot({
      doctorId: "doc-1",
      date,
      workingHours: [-1, 0, 23, 24, 25, Number.NaN, 9],
      bookedHours: [Number.POSITIVE_INFINITY],
      averageServicePriceUzs: 500,
    });
    expect(r.emptyHours).toEqual([0, 9, 23]);
    expect(r.estimatedRevenueLossUzs).toBe(3 * 500);
  });

  it("clamps negative or non-finite avg price to 0", () => {
    const r = computeEmptySlot({
      doctorId: "doc-1",
      date,
      workingHours: [9, 10],
      bookedHours: [],
      averageServicePriceUzs: -100,
    });
    expect(r.emptyHours).toEqual([9, 10]);
    expect(r.estimatedRevenueLossUzs).toBe(0);

    const r2 = computeEmptySlot({
      doctorId: "doc-1",
      date,
      workingHours: [9, 10],
      bookedHours: [],
      averageServicePriceUzs: Number.NaN,
    });
    expect(r2.estimatedRevenueLossUzs).toBe(0);
  });
});

describe("expandScheduleHours", () => {
  it("expands a clean hour-aligned window", () => {
    expect(expandScheduleHours("09:00", "12:00")).toEqual([9, 10, 11]);
  });

  it("includes the partial first/last hour", () => {
    expect(expandScheduleHours("09:30", "11:00")).toEqual([9, 10]);
    expect(expandScheduleHours("09:00", "09:30")).toEqual([9]);
  });

  it("returns [] for zero-length or inverted windows", () => {
    expect(expandScheduleHours("10:00", "10:00")).toEqual([]);
    expect(expandScheduleHours("12:00", "09:00")).toEqual([]);
  });

  it("returns [] for malformed inputs", () => {
    expect(expandScheduleHours("9-30", "11:00")).toEqual([]);
    expect(expandScheduleHours("", "11:00")).toEqual([]);
    expect(expandScheduleHours("25:00", "26:00")).toEqual([]);
  });

  it("handles 24:00 as end-of-day", () => {
    expect(expandScheduleHours("23:00", "24:00")).toEqual([23]);
  });
});
