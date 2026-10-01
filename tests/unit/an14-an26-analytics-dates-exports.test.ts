/**
 * P5 analytics: dates, exports and honest projections (audit AN-14, AN-16,
 * AN-18, AN-21, AN-24, AN-25, AN-26). The DB-reading routes and loaders
 * (AN-17, AN-20, the AN-18 worker) are in an17-an20-loss-revenue.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
}));

import {
  contentDisposition,
  filenameFromContentDisposition,
} from "@/lib/content-disposition";
import {
  FINANCIAL_TREND_DAYS,
  financialWindow,
  projectMonthEnd,
} from "@/lib/analytics/dashboard-math";
import {
  baselineRevenue,
  projectForecast,
  type ForecastDay,
} from "@/lib/revenue/forecast";
import { reportPeriodForRun } from "@/server/analytics/cadence";
import { csvFilename } from "@/server/analytics/csv";
import { buildFinancialSnapshot } from "@/server/analytics/financial-pace-resolver";
import { pdfFilename } from "@/server/analytics/pdf";
import {
  parseReportConfig,
  resolveDateRange,
} from "@/server/analytics/report-config";
import { buildScheduleHeatmap } from "@/server/analytics/schedule-heatmap-resolver";
import { hoursCoveredBy, snapshotEmptySlotsForDay } from "@/server/revenue/empty-slot";
import { emptySlotByWeekday } from "@/server/revenue/forecast-data";

const tashkent = (ymd: string, hm = "00:00") => new Date(`${ymd}T${hm}:00+05:00`);

// ── AN-14 ────────────────────────────────────────────────────────────────

describe("AN-14: report dates are inclusive Tashkent days (fixed in 644eab0)", () => {
  const cfg = (dateFrom: string, dateTo: string) =>
    parseReportConfig({
      version: 1,
      dimensions: ["doctor"],
      measures: ["count_visits"],
      filters: { dateFrom, dateTo },
    });

  it("a one-day report covers that whole clinic day", () => {
    const r = resolveDateRange(cfg("2026-09-15", "2026-09-15"));
    expect(r.dateFrom).toEqual(tashkent("2026-09-15"));
    expect(r.dateTo).toEqual(tashkent("2026-09-16"));
  });

  it("a report to 30.09 includes a 17:00 visit on 30.09", () => {
    const r = resolveDateRange(cfg("2026-09-01", "2026-09-30"));
    const visit = tashkent("2026-09-30", "17:00");
    expect(visit >= r.dateFrom && visit < r.dateTo).toBe(true);
  });
});

// ── AN-16 ────────────────────────────────────────────────────────────────

describe("AN-16: empty-slot losses leave out the doctor's time off", () => {
  function fakeDb(opts: {
    timeOffs: Array<{ doctorId: string; startAt: Date; endAt: Date }>;
    appts?: Array<{ doctorId: string; date: Date; endDate: Date }>;
  }) {
    const inserted: Array<{ doctorId: string; hour: number }> = [];
    const timeOffWheres: unknown[] = [];
    const db = {
      doctor: {
        findMany: async () => [
          { id: "d1", specializationRu: "Невролог", pricePerVisit: 100_000_00 },
        ],
      },
      doctorSchedule: {
        findMany: async () => [
          {
            doctorId: "d1",
            weekday: 3,
            startTime: "09:00",
            endTime: "13:00",
            validFrom: null,
            validTo: null,
          },
        ],
      },
      doctorTimeOff: {
        findMany: async (args: { where: unknown }) => {
          timeOffWheres.push(args.where);
          return opts.timeOffs;
        },
      },
      appointment: { findMany: async () => opts.appts ?? [] },
      serviceOnDoctor: { findMany: async () => [] },
      service: { findMany: async () => [] },
      $transaction: async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          emptySlotSnapshot: {
            deleteMany: async () => ({ count: 0 }),
            createMany: async ({ data }: { data: typeof inserted }) => {
              inserted.push(...data);
              return { count: data.length };
            },
          },
        }),
    };
    return { db, inserted, timeOffWheres };
  }

  // Wednesday 2026-09-30 (DoctorSchedule.weekday 3).
  const day = tashkent("2026-09-30", "12:00");

  it("a doctor on leave the whole day gets no snapshot rows", async () => {
    const { db, inserted, timeOffWheres } = fakeDb({
      timeOffs: [
        { doctorId: "d1", startAt: tashkent("2026-09-21"), endAt: tashkent("2026-10-05") },
      ],
    });
    const r = await snapshotEmptySlotsForDay(db as never, "c1", day);
    expect(r).toEqual({ snapshotsWritten: 0, totalLossUzs: 0 });
    expect(inserted).toEqual([]);
    expect(timeOffWheres[0]).toMatchObject({ clinicId: "c1", doctorId: { in: ["d1"] } });
  });

  it("only the hours outside a part-day leave count as empty", async () => {
    const { db, inserted } = fakeDb({
      timeOffs: [
        { doctorId: "d1", startAt: tashkent("2026-09-30", "09:00"), endAt: tashkent("2026-09-30", "11:00") },
      ],
      appts: [
        { doctorId: "d1", date: tashkent("2026-09-30", "11:00"), endDate: tashkent("2026-09-30", "11:30") },
      ],
    });
    const r = await snapshotEmptySlotsForDay(db as never, "c1", day);
    expect(inserted.map((i) => i.hour)).toEqual([12]);
    expect(r.totalLossUzs).toBe(100_000_00);
  });

  it("hoursCoveredBy counts every Tashkent hour an interval touches", () => {
    const dayStart = tashkent("2026-09-30");
    expect(
      hoursCoveredBy(
        [
          { start: tashkent("2026-09-30", "09:30"), end: tashkent("2026-09-30", "11:00") },
          { start: tashkent("2026-09-30", "10:00"), end: tashkent("2026-09-30", "10:15") },
        ],
        dayStart,
      ),
    ).toEqual([9, 10]);
  });
});

// ── AN-18 ────────────────────────────────────────────────────────────────

describe("AN-18: a schedule reports the window of its cadence", () => {
  const TZ = "Asia/Tashkent";
  // Thursday 24.09.2026, 09:00 Tashkent.
  const runAt = tashkent("2026-09-24", "09:00");

  it("DAILY covers the day before only", () => {
    expect(reportPeriodForRun("DAILY", runAt, TZ)).toEqual({
      dateFrom: "2026-09-23",
      dateTo: "2026-09-23",
    });
  });

  it("WEEKLY covers the previous Monday to Sunday", () => {
    expect(reportPeriodForRun("WEEKLY", tashkent("2026-09-28", "09:00"), TZ)).toEqual({
      dateFrom: "2026-09-21",
      dateTo: "2026-09-27",
    });
  });

  it("MONTHLY covers the previous calendar month, across a year end", () => {
    expect(reportPeriodForRun("MONTHLY", tashkent("2026-10-01", "09:00"), TZ)).toEqual({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });
    expect(reportPeriodForRun("MONTHLY", tashkent("2027-01-01", "09:00"), TZ)).toEqual({
      dateFrom: "2026-12-01",
      dateTo: "2026-12-31",
    });
  });

  it("reads the run day in Tashkent, not UTC", () => {
    // 00:30 on 24.09 in Tashkent is still 23.09 in UTC.
    expect(reportPeriodForRun("DAILY", tashkent("2026-09-24", "00:30"), TZ)).toEqual({
      dateFrom: "2026-09-23",
      dateTo: "2026-09-23",
    });
  });
});

// ── AN-21 ────────────────────────────────────────────────────────────────

describe("AN-21: the what-if sliders move the adjusted forecast", () => {
  const days: ForecastDay[] = [
    { date: "2026-10-01", bookedUzs: 1_000_000, emptySlotUzs: 400_000 },
    { date: "2026-10-02", bookedUzs: 500_000, emptySlotUzs: 0 },
  ];
  const rate = 0.2;
  const adjusted = (sliders: Parameters<typeof projectForecast>[2]) =>
    baselineRevenue(projectForecast(days, rate, sliders));

  it("the base forecast is the booked value net of the usual no-shows", () => {
    expect(adjusted({})).toBe(Math.round(1_500_000 * 0.8));
  });

  it("fewer no-shows add booked × rate × reduction", () => {
    const delta = adjusted({ reduceNoShowPct: 30 }) - adjusted({});
    expect(delta).toBe(Math.round(1_500_000 * rate * 0.3));
    // Twice the historical rate, twice the gain: proportional to it.
    const doubled =
      baselineRevenue(projectForecast(days, 0.4, { reduceNoShowPct: 30 })) -
      baselineRevenue(projectForecast(days, 0.4, {}));
    expect(doubled).toBe(2 * delta);
  });

  it("filling empty slots adds the measured empty value, not 2.5%", () => {
    const delta = adjusted({ fillEmptyPct: 50 }) - adjusted({});
    expect(delta).toBe(Math.round(400_000 * 0.5 * (1 - rate)));
  });

  it("the usual empty value averages each weekday over the engine's days", () => {
    // Engine ran from Monday 21.09; today is Monday 28.09. Tuesday 22.09
    // had 300 000 empty; Wednesday 23.09 was fully booked (no rows).
    const out = emptySlotByWeekday(
      [
        { date: tashkent("2026-09-21"), estimatedRevenueLossUzs: 100_000 },
        { date: tashkent("2026-09-22"), estimatedRevenueLossUzs: 200_000 },
        { date: tashkent("2026-09-22"), estimatedRevenueLossUzs: 100_000 },
      ],
      "2026-09-28",
    );
    expect(out.available).toBe(true);
    expect(out.byWeekday[1]).toBe(100_000); // Monday
    expect(out.byWeekday[2]).toBe(300_000); // Tuesday
    expect(out.byWeekday[3]).toBe(0); // Wednesday, booked out
    expect(out.weeklyUzs).toBe(400_000);
    expect(emptySlotByWeekday([], "2026-09-28").available).toBe(false);
  });
});

// ── AN-24 ────────────────────────────────────────────────────────────────

describe("AN-24: the heatmap is in Tashkent hours with real free hours", () => {
  // Monday 2026-09-28, weekday 1.
  const days = ["2026-09-28"];
  const schedules = [
    {
      doctorId: "d1",
      weekday: 1,
      startTime: "09:00",
      endTime: "12:00",
      validFrom: null,
      validTo: null,
    },
  ];

  it("a 09:30 Tashkent visit lands in column 09", () => {
    const cells = buildScheduleHeatmap({
      days,
      schedules,
      timeOffs: [],
      visits: [
        { doctorId: "d1", date: tashkent("2026-09-28", "09:30"), endDate: tashkent("2026-09-28", "10:00") },
      ],
    });
    const nine = cells.find((c) => c.hour === 9)!;
    expect(nine).toMatchObject({ dayOfWeek: 1, appointmentCount: 1, workingHourCount: 1, freeHourCount: 0 });
    expect(cells.find((c) => c.hour === 4)).toBeUndefined();
    // Free is the working hours with no visit, never the visit count.
    expect(cells.find((c) => c.hour === 10)).toMatchObject({ workingHourCount: 1, freeHourCount: 1 });
    expect(cells.find((c) => c.hour === 11)).toMatchObject({ workingHourCount: 1, freeHourCount: 1 });
  });

  it("time off is not working time; no schedule means no free claim", () => {
    const cells = buildScheduleHeatmap({
      days,
      schedules,
      timeOffs: [
        { doctorId: "d1", startAt: tashkent("2026-09-28", "10:00"), endAt: tashkent("2026-09-28", "12:00") },
      ],
      visits: [
        { doctorId: "d2", date: tashkent("2026-09-28", "15:00"), endDate: tashkent("2026-09-28", "15:30") },
      ],
    });
    expect(cells.filter((c) => c.doctorId === "d1").map((c) => c.hour)).toEqual([9]);
    expect(cells.find((c) => c.doctorId === "d2")).toMatchObject({
      hour: 15,
      appointmentCount: 1,
      workingHourCount: 0,
      freeHourCount: 0,
    });
  });
});

// ── AN-25 ────────────────────────────────────────────────────────────────

describe("AN-25: the financial dashboard keeps its window and says when", () => {
  it("the window is 90 Tashkent days through the month end", () => {
    // 19:30 UTC on 30.09 is 00:30 on 01.10 in Tashkent.
    const w = financialWindow(new Date("2026-09-30T19:30:00Z"));
    expect(w.todayKey).toBe("2026-10-01");
    expect(w.monthStart).toBe("2026-10-01");
    expect(w.toExcl).toBe("2026-11-01");
    expect(w.from).toBe("2026-07-04");
    expect(financialWindow(new Date("2026-09-30T19:30:00Z"), FINANCIAL_TREND_DAYS)).toEqual(w);
  });

  it("the auto-refresh asks for the same window it was seeded with", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "src/app/[locale]/crm/analytics/financial/_components/financial-dashboard-client.tsx",
      "utf8",
    );
    expect(src).toContain("/api/crm/analytics/financial?days=${FINANCIAL_TREND_DAYS}");
  });

  it("today is live, the data time is the view's refresh", () => {
    const window = financialWindow(new Date("2026-09-30T19:30:00Z"));
    const refreshedAt = new Date("2026-09-30T19:00:00Z");
    const row = (day: string, collected: number) => ({
      clinicId: "c1",
      day: new Date(`${day}T00:00:00Z`),
      revenueCollectedTiins: BigInt(collected),
      revenueScheduledTiins: 0,
      noShowLossTiins: 0,
      refreshedAt,
    });
    const snap = buildFinancialSnapshot({
      rows: [row("2026-09-30", 500), row("2026-10-01", 0)],
      window,
      todayCollectedLiveTiins: 7_000,
      trackedSince: new Date("2026-06-01T00:00:00+05:00"),
      now: new Date("2026-09-30T19:31:00Z"),
    });
    expect(snap.today?.revenueCollectedTiins).toBe(7_000);
    expect(snap.mtd.revenueCollectedTiins).toBe(7_000);
    expect(snap.dataAsOf).toBe(refreshedAt.toISOString());
    expect(snap.daily).toHaveLength(2);
    expect(snap.range).toEqual({ from: "2026-07-04", toExcl: "2026-11-01" });
  });

  it("the month-end projection uses the Tashkent day of month", () => {
    // 00:30 on 01.10 Tashkent: day 1 of a 31-day month, not day 30 of 30.
    const p = projectMonthEnd(1_000, new Date("2026-09-30T19:30:00Z"));
    expect(p.dayOfMonth).toBe(1);
    expect(p.daysInMonth).toBe(31);
    expect(p.projectedTiins).toBe(31_000);
  });
});

// ── AN-26 ────────────────────────────────────────────────────────────────

describe("AN-26: exports with a Cyrillic or Uzbek name download", () => {
  const now = new Date("2026-09-30T10:00:00Z");

  it.each(["Выручка по врачам", "Oʻrtacha chek", "O'rtacha (chek)*"])(
    "%s builds a legal header that names the file in UTF-8",
    (name) => {
      for (const filename of [csvFilename(name, now), pdfFilename(name, now)]) {
        const header = contentDisposition(filename);
        // The Response constructor threw on any character above U+00FF.
        expect(() => new Response("x", { headers: { "content-disposition": header } })).not.toThrow();
        expect(header).toMatch(/^attachment; filename="[\x20-\x7E]+"; filename\*=UTF-8''/);
        expect(header.split("filename*=UTF-8''")[1]).not.toMatch(/['()*]/);
        expect(filenameFromContentDisposition(header, "report")).toBe(filename);
      }
    },
  );

  it("the file name keeps the report name and the Tashkent date", () => {
    expect(csvFilename("Выручка по врачам", new Date("2026-09-30T20:00:00Z"))).toBe(
      "Выручка-по-врачам-2026-10-01.csv",
    );
  });

  it("the parser falls back to the plain name, then to the default", () => {
    expect(filenameFromContentDisposition('attachment; filename="a.csv"', "x")).toBe("a.csv");
    expect(filenameFromContentDisposition(null, "report.pdf")).toBe("report.pdf");
    expect(contentDisposition("Анализ.png", { inline: true })).toMatch(/^inline; /);
  });
});
