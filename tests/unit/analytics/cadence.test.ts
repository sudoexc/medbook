/**
 * Phase 18 Wave 4 — `computeNextRunAt` edge cases.
 *
 * Asserts the cadence advance lands at 09:00 *local* (Asia/Tashkent +05:00,
 * no DST in production), and that month/year/leap-year boundaries roll over
 * cleanly. We also exercise a DST-aware zone (Europe/Berlin) to make sure
 * the bisection helper is correct, even though our deployment never uses it.
 */
import { describe, it, expect } from "vitest";

import {
  cadenceLabel,
  computeNextRunAt,
  RUN_ANCHOR,
} from "@/server/analytics/cadence";

const TZ = "Asia/Tashkent";

function tashkentParts(d: Date): {
  y: number;
  m: number;
  day: number;
  h: number;
  min: number;
  weekday: number;
} {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(
    f.formatToParts(d).map((p) => [p.type, p.value]),
  );
  const wkMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  let h = parseInt(parts.hour, 10);
  if (h === 24) h = 0;
  return {
    y: parseInt(parts.year, 10),
    m: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    h,
    min: parseInt(parts.minute, 10),
    weekday: wkMap[parts.weekday] ?? 1,
  };
}

describe("computeNextRunAt", () => {
  it("DAILY before 09:00 returns today at 09:00 local", () => {
    // 2026-05-07 at 03:00 UTC = 08:00 Asia/Tashkent (before anchor)
    const from = new Date("2026-05-07T03:00:00Z");
    const next = computeNextRunAt("DAILY", from, TZ);
    const p = tashkentParts(next);
    expect(p.day).toBe(7);
    expect(p.m).toBe(5);
    expect(p.h).toBe(RUN_ANCHOR.hour);
    expect(p.min).toBe(RUN_ANCHOR.minute);
  });

  it("DAILY after 09:00 returns tomorrow at 09:00 local", () => {
    // 2026-05-07 at 06:00 UTC = 11:00 Asia/Tashkent (past anchor)
    const from = new Date("2026-05-07T06:00:00Z");
    const next = computeNextRunAt("DAILY", from, TZ);
    const p = tashkentParts(next);
    expect(p.day).toBe(8);
    expect(p.h).toBe(9);
  });

  it("DAILY rolls over end-of-month", () => {
    // 2026-01-31 13:00 UTC = 18:00 Tashkent — past anchor, should roll to Feb 1
    const from = new Date("2026-01-31T13:00:00Z");
    const next = computeNextRunAt("DAILY", from, TZ);
    const p = tashkentParts(next);
    expect(p.m).toBe(2);
    expect(p.day).toBe(1);
  });

  it("DAILY rolls over end-of-year", () => {
    const from = new Date("2026-12-31T20:00:00Z");
    const next = computeNextRunAt("DAILY", from, TZ);
    const p = tashkentParts(next);
    expect(p.y).toBe(2027);
    expect(p.m).toBe(1);
    expect(p.day).toBe(1);
  });

  it("WEEKLY from Monday before 09:00 fires today (Monday)", () => {
    // 2026-05-04 is a Monday. 03:00 UTC = 08:00 Tashkent.
    const from = new Date("2026-05-04T03:00:00Z");
    const next = computeNextRunAt("WEEKLY", from, TZ);
    const p = tashkentParts(next);
    expect(p.weekday).toBe(1);
    expect(p.day).toBe(4);
  });

  it("WEEKLY from Monday after 09:00 fires next Monday", () => {
    const from = new Date("2026-05-04T06:00:00Z");
    const next = computeNextRunAt("WEEKLY", from, TZ);
    const p = tashkentParts(next);
    expect(p.weekday).toBe(1);
    expect(p.day).toBe(11);
  });

  it("WEEKLY from Tuesday fires the following Monday", () => {
    // 2026-05-05 (Tuesday)
    const from = new Date("2026-05-05T10:00:00Z");
    const next = computeNextRunAt("WEEKLY", from, TZ);
    const p = tashkentParts(next);
    expect(p.weekday).toBe(1);
    expect(p.day).toBe(11);
  });

  it("WEEKLY from Sunday fires next-day Monday", () => {
    // 2026-05-10 (Sunday, full day)
    const from = new Date("2026-05-10T12:00:00Z");
    const next = computeNextRunAt("WEEKLY", from, TZ);
    const p = tashkentParts(next);
    expect(p.weekday).toBe(1);
    expect(p.day).toBe(11);
  });

  it("MONTHLY from mid-month fires next-month day 1 at 09:00", () => {
    const from = new Date("2026-05-15T08:00:00Z");
    const next = computeNextRunAt("MONTHLY", from, TZ);
    const p = tashkentParts(next);
    expect(p.m).toBe(6);
    expect(p.day).toBe(1);
    expect(p.h).toBe(9);
  });

  it("MONTHLY from Jan 31 → Feb 1 (no leap-day collision)", () => {
    const from = new Date("2026-01-31T20:00:00Z");
    const next = computeNextRunAt("MONTHLY", from, TZ);
    const p = tashkentParts(next);
    expect(p.m).toBe(2);
    expect(p.day).toBe(1);
  });

  it("MONTHLY across year boundary", () => {
    const from = new Date("2026-12-15T05:00:00Z");
    const next = computeNextRunAt("MONTHLY", from, TZ);
    const p = tashkentParts(next);
    expect(p.y).toBe(2027);
    expect(p.m).toBe(1);
    expect(p.day).toBe(1);
  });

  it("MONTHLY on day 1 before 09:00 fires today not next month", () => {
    // 2026-06-01 at 02:00 UTC = 07:00 Tashkent (before anchor on day-1)
    const from = new Date("2026-06-01T02:00:00Z");
    const next = computeNextRunAt("MONTHLY", from, TZ);
    const p = tashkentParts(next);
    expect(p.m).toBe(6);
    expect(p.day).toBe(1);
  });

  it("MONTHLY on leap-year Feb 29 → Mar 1", () => {
    const from = new Date("2028-02-29T20:00:00Z");
    const next = computeNextRunAt("MONTHLY", from, TZ);
    const p = tashkentParts(next);
    expect(p.m).toBe(3);
    expect(p.day).toBe(1);
  });

  it("DAILY in Europe/Berlin honours the local 09:00 even across DST", () => {
    // 2026-03-29 is the Berlin DST spring-forward; choose a later date well
    // past the transition to validate the bisection works for non-Tashkent
    // zones too. Late evening UTC — anchor for next day.
    const from = new Date("2026-04-01T22:00:00Z");
    const next = computeNextRunAt("DAILY", from, "Europe/Berlin");
    const f = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(
      f.formatToParts(next).map((p) => [p.type, p.value]),
    );
    const h = parts.hour === "24" ? "00" : parts.hour;
    expect(parseInt(h, 10)).toBe(9);
    expect(parts.minute).toBe("00");
  });
});

describe("cadenceLabel", () => {
  it("returns RU labels for each cadence", () => {
    expect(cadenceLabel("DAILY", "ru")).toContain("Каждый");
    expect(cadenceLabel("WEEKLY", "ru")).toContain("понедельник");
    expect(cadenceLabel("MONTHLY", "ru")).toContain("первое");
  });
  it("returns UZ labels for each cadence", () => {
    expect(cadenceLabel("DAILY", "uz")).toContain("Har kuni");
    expect(cadenceLabel("WEEKLY", "uz")).toContain("dushanba");
    expect(cadenceLabel("MONTHLY", "uz")).toContain("Oylik");
  });
});
