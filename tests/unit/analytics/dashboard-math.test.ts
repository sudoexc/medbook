/**
 * Phase 18 Wave 2 — pure-helper tests for the dashboard math.
 *
 * Covers:
 *   • resolveDoctorPerfRange — 30d / 90d / YTD / custom / fallback
 *   • trailingMonths — default 12-month cohort window
 *   • projectMonthEnd — linear month-end extrapolation
 *   • computeQuartileBand / bandOf — top-25/bottom-25 row classification
 *
 * No DB, no React. The functions live in `src/lib/analytics/` so the
 * client dashboards can import them without dragging Prisma into the
 * browser bundle.
 */
import { describe, it, expect } from "vitest";

import {
  bandOf,
  computeQuartileBand,
  projectMonthEnd,
  resolveDoctorPerfRange,
  trailingMonths,
} from "@/lib/analytics/dashboard-math";

describe("resolveDoctorPerfRange", () => {
  const NOW = new Date(Date.UTC(2026, 4, 7, 9, 30)); // 2026-05-07 09:30 UTC

  it("30d → trailing 30 day window ending tomorrow-midnight", () => {
    const r = resolveDoctorPerfRange("30d", NOW);
    expect(r.kind).toBe("30d");
    const days = Math.round(
      (r.to.getTime() - r.from.getTime()) / (24 * 3600 * 1000),
    );
    expect(days).toBe(30);
    // to is exclusive — tomorrow at midnight
    expect(r.to.getUTCHours()).toBe(0);
    expect(r.to.getUTCDate()).toBe(8);
  });

  it("90d → trailing 90 day window", () => {
    const r = resolveDoctorPerfRange("90d", NOW);
    const days = Math.round(
      (r.to.getTime() - r.from.getTime()) / (24 * 3600 * 1000),
    );
    expect(days).toBe(90);
    expect(r.kind).toBe("90d");
  });

  it("ytd → Jan 1 of current year through tomorrow-midnight", () => {
    const r = resolveDoctorPerfRange("ytd", NOW);
    expect(r.from.getUTCMonth()).toBe(0);
    expect(r.from.getUTCDate()).toBe(1);
    expect(r.from.getUTCFullYear()).toBe(2026);
    expect(r.kind).toBe("ytd");
  });

  it("custom with valid bounds bumps `to` to exclusive upper", () => {
    const r = resolveDoctorPerfRange("custom", NOW, {
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(r.kind).toBe("custom");
    expect(r.from.getUTCDate()).toBe(1);
    expect(r.from.getUTCMonth()).toBe(0);
    // inclusive 2026-01-31 → exclusive 2026-02-01
    expect(r.to.getUTCDate()).toBe(1);
    expect(r.to.getUTCMonth()).toBe(1);
  });

  it("custom with invalid bounds falls back to 30d", () => {
    const r = resolveDoctorPerfRange("custom", NOW, {
      from: "not-a-date",
      to: "also-not",
    });
    expect(r.kind).toBe("30d");
  });

  it("custom with from >= to falls back to 30d", () => {
    const r = resolveDoctorPerfRange("custom", NOW, {
      from: "2026-05-01",
      to: "2026-04-01",
    });
    expect(r.kind).toBe("30d");
  });
});

describe("trailingMonths", () => {
  const NOW = new Date(Date.UTC(2026, 4, 7, 0, 0)); // 2026-05-07 UTC

  it("returns 12 months by default", () => {
    const r = trailingMonths(NOW, 12);
    expect(r.monthCount).toBe(12);
    expect(r.toMonth).toBe("2026-05");
    expect(r.fromMonth).toBe("2025-06");
  });

  it("clamps requested months to [1, 24]", () => {
    expect(trailingMonths(NOW, 0).monthCount).toBe(1);
    expect(trailingMonths(NOW, 100).monthCount).toBe(24);
  });

  it("trailing 1 month produces only the current cohort", () => {
    const r = trailingMonths(NOW, 1);
    expect(r.fromMonth).toBe("2026-05");
    expect(r.toMonth).toBe("2026-05");
  });
});

describe("projectMonthEnd", () => {
  it("scales MTD → full month length", () => {
    // Day 10 of a 30-day month, MTD = 10 000 000 tiins → projected = 30 000 000
    const NOW = new Date(Date.UTC(2026, 5, 10, 12, 0)); // 2026-06-10
    const { projectedTiins, dayOfMonth, daysInMonth } = projectMonthEnd(
      10_000_000,
      NOW,
    );
    expect(dayOfMonth).toBe(10);
    expect(daysInMonth).toBe(30);
    expect(projectedTiins).toBe(30_000_000);
  });

  it("rounds projected output to whole tiins", () => {
    const NOW = new Date(Date.UTC(2026, 0, 7, 12, 0)); // Jan 7 (31 days)
    const { projectedTiins } = projectMonthEnd(123_456, NOW);
    // (123456 * 31) / 7 = 3827136 / 7 = 546_733.714… → rounds to 546_734.
    expect(projectedTiins).toBe(546_734);
  });

  it("returns mtd unchanged when dayOfMonth pathologically <= 0", () => {
    const fake = { getUTCDate: () => 0, getUTCFullYear: () => 2026, getUTCMonth: () => 0 } as Date;
    const { projectedTiins } = projectMonthEnd(42, fake);
    expect(projectedTiins).toBe(42);
  });
});

describe("computeQuartileBand / bandOf", () => {
  it("returns null thresholds for fewer than 4 values", () => {
    expect(computeQuartileBand([])).toEqual({
      topThreshold: null,
      bottomThreshold: null,
    });
    expect(computeQuartileBand([1, 2, 3])).toEqual({
      topThreshold: null,
      bottomThreshold: null,
    });
  });

  it("computes p25/p75 thresholds for an 8-value series", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80];
    const band = computeQuartileBand(values);
    // floor(8 * 0.25) = 2 → idx 2 = 30  (bottom)
    // floor(8 * 0.75) = 6 → idx 6 = 70  (top)
    expect(band.bottomThreshold).toBe(30);
    expect(band.topThreshold).toBe(70);
  });

  it("classifies values into top/bottom/mid bands", () => {
    const band = { bottomThreshold: 30, topThreshold: 70 };
    expect(bandOf(80, band)).toBe("top");
    expect(bandOf(70, band)).toBe("top");
    expect(bandOf(50, band)).toBe("mid");
    expect(bandOf(30, band)).toBe("bottom");
    expect(bandOf(10, band)).toBe("bottom");
  });

  it("returns 'mid' when thresholds are null", () => {
    const band = { bottomThreshold: null, topThreshold: null };
    expect(bandOf(999, band)).toBe("mid");
  });
});
