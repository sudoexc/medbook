/**
 * Audit UX-03: the analytics dashboard shows no invented numbers.
 *
 *   - «Причины неявок» spread the no-shows over ten fixed weights
 *     («пациент забыл 22 %») though no reason is recorded anywhere;
 *   - «Динамика загрузки клиники» was each day's visits over the busiest
 *     day × 90 %, so the busiest day always read 90 %;
 *   - the deltas compared the two halves of the period in the browser: a
 *     week became 3 days against 4, a flat revenue read «+33 %».
 *
 * Acceptance: a flat revenue gives a delta of about 0 %; no earlier data,
 * no chip; the load matches booked minutes over the schedule; the weights
 * and the 90 % are gone from the code.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  previousWindow,
  rateDeltaPp,
  relativeDeltaPct,
} from "@/server/analytics/period-compare";
import { computeClinicLoad } from "@/server/analytics/clinic-load";

describe("period-over-period deltas", () => {
  it("the previous window has the same length and ends where this one starts", () => {
    // A week: 23.09 00:00 to 30.09 00:00 Tashkent.
    const from = new Date("2026-09-22T19:00:00.000Z");
    const to = new Date("2026-09-29T19:00:00.000Z");
    expect(previousWindow(from, to)).toEqual({
      from: new Date("2026-09-15T19:00:00.000Z"),
      to: from,
    });
  });

  it("a flat revenue is 0 %, not +33 %", () => {
    // 7 days × 1 000 000 against the 7 days before at the same pace.
    expect(relativeDeltaPct(7_000_000, 7_000_000)).toBe(0);
    expect(relativeDeltaPct(7_700_000, 7_000_000)).toBe(10);
  });

  it("nothing to compare with: no delta", () => {
    expect(relativeDeltaPct(5_000_000, 0)).toBeNull();
    expect(rateDeltaPp({ part: 3, whole: 40 }, { part: 0, whole: 0 })).toBeNull();
    expect(rateDeltaPp({ part: 0, whole: 0 }, { part: 3, whole: 40 })).toBeNull();
  });

  it("rates move in percentage points", () => {
    expect(rateDeltaPp({ part: 5, whole: 100 }, { part: 10, whole: 100 })).toBe(-5);
  });
});

describe("computeClinicLoad", () => {
  // Mon–Fri 09:00–17:00 (480 min a day).
  const schedules = [1, 2, 3, 4, 5].map((weekday) => ({
    doctorId: "doc_aziz",
    weekday,
    startTime: "09:00",
    endTime: "17:00",
  }));

  it("booked minutes over the schedule's minutes; a day off has no load", () => {
    const out = computeClinicLoad({
      // Fri 25.09, Sat 26.09, Sun 27.09, Mon 28.09.
      days: ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"],
      doctorIds: ["doc_aziz"],
      schedules,
      timeOffs: [],
      visits: [
        // Friday 10:00 Tashkent, two hours.
        { doctorId: "doc_aziz", date: new Date("2026-09-25T05:00:00.000Z"), durationMin: 120 },
        // Monday, four hours in total.
        { doctorId: "doc_aziz", date: new Date("2026-09-28T04:00:00.000Z"), durationMin: 180 },
        { doctorId: "doc_aziz", date: new Date("2026-09-28T09:00:00.000Z"), durationMin: 60 },
      ],
    });
    expect(out.daily).toEqual([
      { date: "2026-09-25", bookedMin: 120, workingMin: 480, load: 25 },
      { date: "2026-09-26", bookedMin: 0, workingMin: 0, load: null },
      { date: "2026-09-27", bookedMin: 0, workingMin: 0, load: null },
      { date: "2026-09-28", bookedMin: 240, workingMin: 480, load: 50 },
    ]);
    // The card's figure is over the whole window, not an average of days.
    expect(out).toMatchObject({ bookedMin: 360, workingMin: 960, loadPct: 38 });
  });

  it("nobody works in the window: no load at all", () => {
    const out = computeClinicLoad({
      days: ["2026-09-26"],
      doctorIds: ["doc_aziz"],
      schedules,
      timeOffs: [],
      visits: [],
    });
    expect(out.loadPct).toBeNull();
  });
});

describe("the dashboard code has no synthetic numbers left", () => {
  const read = (rel: string) =>
    readFileSync(
      path.resolve(__dirname, "../../src/app/[locale]/crm/analytics/_components", rel),
      "utf8",
    );

  it("no reason weights, no 90 % baseline, no half-period deltas", () => {
    const cards = read("funnel-cards.tsx");
    expect(cards).not.toMatch(/NO_SHOW_WEIGHTS|\* 90\)|slice\(half\)/);
    const charts = read("analytics-charts.tsx");
    expect(charts).not.toMatch(/Math\.floor\(data\.revenueDaily\.length \/ 2\)|slice\(half\)/);
    expect(charts).toContain("data.deltas?.revenuePct");
    const page = read("analytics-page-client.tsx");
    expect(page).not.toMatch(/REASON_KEYS|patientForgot/);
  });
});
