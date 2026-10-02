/**
 * Audit UX-12 — the doctor cabinet printed dates from hard-coded Russian
 * month arrays, so the Uzbek interface read «23 сентября, вт».
 * `formatCalendarDay` gives Uzbek its own months and keeps the Russian
 * wording exactly as the cabinet showed it.
 */
import { describe, expect, it } from "vitest";

import { formatCalendarDay } from "@/lib/format";

// 23 Sep 2026, 14:30 in Tashkent (UTC+5).
const AT = new Date("2026-09-23T09:30:00Z");

describe("formatCalendarDay", () => {
  it("keeps the Russian cabinet wording", () => {
    expect(formatCalendarDay(AT, "ru")).toBe("23 сент.");
    expect(formatCalendarDay(AT, "ru", { year: true })).toBe("23 сент. 2026");
    expect(formatCalendarDay(AT, "ru", { month: "long", weekday: true })).toBe(
      "23 сентября, ср",
    );
    expect(
      formatCalendarDay(AT, "ru", { month: "long", year: true, time: true }),
    ).toBe("23 сентября 2026, 14:30");
    // The genitive short forms Intl would print as «июн.» / «июл.».
    expect(formatCalendarDay(new Date("2026-06-05T09:00:00Z"), "ru")).toBe("5 июня");
    expect(formatCalendarDay(new Date("2026-07-05T09:00:00Z"), "ru")).toBe("5 июля");
  });

  it("prints Uzbek months for the Uzbek interface", () => {
    expect(formatCalendarDay(AT, "uz")).toBe("23-sen");
    expect(formatCalendarDay(AT, "uz", { year: true })).toBe("23-sen, 2026");
    expect(formatCalendarDay(AT, "uz", { month: "long", weekday: true })).toBe(
      "23-sentabr, Chor",
    );
    expect(formatCalendarDay(AT, "uz", { year: true, time: true })).toBe(
      "23-sen, 2026, 14:30",
    );
    expect(
      formatCalendarDay(AT, "uz", { month: "long", year: true, weekday: true }),
    ).not.toMatch(/[а-яё]/i);
  });

  it("reads the day in the clinic's zone, not the runtime's", () => {
    // 20:30 UTC on the 22nd is already 01:30 on the 23rd in Tashkent.
    const lateUtc = new Date("2026-09-22T20:30:00Z");
    expect(formatCalendarDay(lateUtc, "ru", { weekday: true, time: true })).toBe(
      "23 сент., ср, 01:30",
    );
    expect(formatCalendarDay(lateUtc, "uz")).toBe("23-sen");
    // A date-only column (UTC midnight) keeps its calendar day.
    expect(formatCalendarDay("1972-03-08T00:00:00.000Z", "ru", { month: "long", year: true })).toBe(
      "8 марта 1972",
    );
  });

  it("treats an unknown locale as Russian and empty input as empty", () => {
    expect(formatCalendarDay(AT, "en")).toBe("23 сент.");
    expect(formatCalendarDay(null, "ru")).toBe("");
    expect(formatCalendarDay("", "uz")).toBe("");
    expect(formatCalendarDay("not a date", "ru")).toBe("");
  });
});
