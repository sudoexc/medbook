/**
 * Review fixes for a18d52d (analytics-dates-exports):
 *   - AN-18: a schedule re-enabled or picked up long after its nextRunAt
 *     reports the latest window due, not the period of the stale slot; the
 *     off-to-on switch recomputes nextRunAt;
 *   - AN-25: when payment recording begins mid-month, month-to-date, the
 *     month-end forecast and the 90-day trend cover only fully recorded
 *     days (no forecast from a part of the month, no zeros before it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  savedReport: null as Row | null,
  runReportConfigs: [] as Row[],
  existingSchedule: null as Row | null,
  scheduleUpdates: [] as Row[],
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT", clinicId: "c1", userId: "u1", role: "ADMIN" }),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u1", role: "ADMIN", clinicId: "c1", email: "x@example.test" },
  })),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

vi.mock("@/server/analytics/report-runner", () => ({
  runReport: vi.fn(async (_client: unknown, _clinicId: string, config: Row) => {
    h.runReportConfigs.push(config);
    return {
      rows: [{ doctor: "Султанов", count_visits: 3 }],
      columns: [
        { key: "doctor", label: "Врач", kind: "dimension", unit: "text" },
        { key: "count_visits", label: "Визиты", kind: "measure", unit: "count" },
      ],
      rowCount: 1,
      truncated: false,
      runMs: 1,
      generatedAt: new Date().toISOString(),
    };
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    savedReport: { findFirst: vi.fn(async () => h.savedReport) },
    scheduledReport: {
      findFirst: vi.fn(async () => h.existingSchedule),
      update: vi.fn(async ({ data }: { data: Row }) => {
        h.scheduleUpdates.push(data);
        return {
          ...(h.existingSchedule ?? {}),
          ...data,
          nextRunAt: (data.nextRunAt as Date | undefined) ?? new Date("2026-10-06T04:00:00Z"),
          updatedAt: new Date(),
        };
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));

import { buildFinancialSnapshot, resolveFinancialPace } from "@/server/analytics/financial-pace-resolver";
import { financialWindow } from "@/lib/analytics/dashboard-math";
import {
  latestRunAtOrBefore,
  reportPeriodForRun,
  reportRunAnchor,
} from "@/server/analytics/cadence";
import { processSchedule } from "@/server/workers/scheduled-reports";
import { PATCH as schedulePATCH } from "@/app/api/crm/analytics/reports/[id]/schedules/[scheduleId]/route";

const TZ = "Asia/Tashkent";
const tashkent = (ymd: string, hm = "00:00") => new Date(`${ymd}T${hm}:00+05:00`);

beforeEach(() => {
  h.savedReport = null;
  h.runReportConfigs = [];
  h.existingSchedule = null;
  h.scheduleUpdates = [];
});

afterEach(() => {
  vi.useRealTimers();
});

// ── AN-18 ────────────────────────────────────────────────────────────────

describe("AN-18 review: a stale nextRunAt does not send an old period", () => {
  it("the latest slot at or before now, per cadence", () => {
    expect(latestRunAtOrBefore("DAILY", tashkent("2026-10-20", "10:00"), TZ)).toEqual(
      tashkent("2026-10-20", "09:00"),
    );
    expect(latestRunAtOrBefore("DAILY", tashkent("2026-10-20", "08:59"), TZ)).toEqual(
      tashkent("2026-10-19", "09:00"),
    );
    // Wednesday 21.10 → Monday 19.10; Monday 19.10 before 09:00 → 12.10.
    expect(latestRunAtOrBefore("WEEKLY", tashkent("2026-10-21", "15:00"), TZ)).toEqual(
      tashkent("2026-10-19", "09:00"),
    );
    expect(latestRunAtOrBefore("WEEKLY", tashkent("2026-10-19", "08:00"), TZ)).toEqual(
      tashkent("2026-10-12", "09:00"),
    );
    expect(latestRunAtOrBefore("MONTHLY", tashkent("2026-10-15", "12:00"), TZ)).toEqual(
      tashkent("2026-10-01", "09:00"),
    );
    // The 1st before 09:00 still belongs to the previous slot, across a year.
    expect(latestRunAtOrBefore("MONTHLY", tashkent("2027-01-01", "08:00"), TZ)).toEqual(
      tashkent("2026-12-01", "09:00"),
    );
  });

  it("a tick late within one step still reports the day it was due for", () => {
    const due = tashkent("2026-09-24", "09:00");
    for (const now of [tashkent("2026-09-24", "23:00"), tashkent("2026-09-25", "08:00")]) {
      const anchor = reportRunAnchor("DAILY", due, now, TZ);
      expect(anchor).toEqual(due);
      expect(reportPeriodForRun("DAILY", anchor, TZ)).toEqual({
        dateFrom: "2026-09-23",
        dateTo: "2026-09-23",
      });
    }
  });

  it("more than a step behind, the latest due window is reported", () => {
    const now = tashkent("2026-10-20", "10:00");
    expect(
      reportPeriodForRun("DAILY", reportRunAnchor("DAILY", tashkent("2026-10-06", "09:00"), now, TZ), TZ),
    ).toEqual({ dateFrom: "2026-10-19", dateTo: "2026-10-19" });
    expect(
      reportPeriodForRun(
        "WEEKLY",
        reportRunAnchor("WEEKLY", tashkent("2026-10-05", "09:00"), tashkent("2026-10-21", "10:00"), TZ),
        TZ,
      ),
    ).toEqual({ dateFrom: "2026-10-12", dateTo: "2026-10-18" });
    expect(
      reportPeriodForRun(
        "MONTHLY",
        reportRunAnchor("MONTHLY", tashkent("2026-06-01", "09:00"), tashkent("2026-10-15", "10:00"), TZ),
        TZ,
      ),
    ).toEqual({ dateFrom: "2026-09-01", dateTo: "2026-09-30" });
  });

  it("the worker runs and names yesterday for a schedule disabled since 06.10", async () => {
    h.savedReport = {
      id: "s1",
      name: "Выручка",
      description: null,
      config: {
        version: 1,
        dimensions: ["doctor"],
        measures: ["count_visits"],
        filters: { dateFrom: "2026-04-01", dateTo: "2026-04-30" },
      },
      clinic: { nameRu: "NeuroFax", nameUz: "NeuroFax" },
    };
    const deliver = vi.fn(async () => ({ ok: true }));
    const r = await processSchedule(
      {
        id: "sch1",
        clinicId: "c1",
        savedReportId: "s1",
        cadence: "DAILY",
        nextRunAt: tashkent("2026-10-06", "09:00"),
        deliveryChannel: "EMAIL",
        deliveryTarget: "owner@clinic.uz",
        format: "csv",
        consecutiveFailures: 0,
        enabled: true,
      },
      { deliver, now: () => tashkent("2026-10-20", "10:00") },
    );
    expect(r.ok).toBe(true);
    const filters = (h.runReportConfigs[0] as { filters: Row }).filters;
    expect(filters).toMatchObject({ dateFrom: "2026-10-19", dateTo: "2026-10-19" });
    const payload = (deliver.mock.calls[0] as unknown as [{ payload: Row }])[0].payload;
    expect(payload.subject).toBe("Выручка: отчёт за 19.10.2026");
  });

  const patch = (body: Row) =>
    schedulePATCH(
      new Request("http://x/api/crm/analytics/reports/r1/schedules/sch1", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );

  it("turning a disabled schedule back on starts it from the next slot", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(tashkent("2026-10-20", "10:00"));
    h.existingSchedule = {
      id: "sch1",
      cadence: "DAILY",
      deliveryChannel: "TELEGRAM",
      deliveryTarget: "12345",
      format: "csv",
      enabled: false,
    };
    const res = await patch({ enabled: true });
    expect(res.status).toBe(200);
    expect(h.scheduleUpdates[0]).toMatchObject({
      enabled: true,
      consecutiveFailures: 0,
      lastFailureReason: null,
      nextRunAt: tashkent("2026-10-21", "09:00"),
    });
  });

  it("resending enabled:true on a live schedule keeps the slot that is due", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(tashkent("2026-10-20", "09:02"));
    h.existingSchedule = {
      id: "sch1",
      cadence: "DAILY",
      deliveryChannel: "EMAIL",
      deliveryTarget: "owner@clinic.uz",
      format: "csv",
      enabled: true,
    };
    const res = await patch({ enabled: true, format: "pdf" });
    expect(res.status).toBe(200);
    expect(h.scheduleUpdates[0]).not.toHaveProperty("nextRunAt");
  });
});

// ── AN-25 ────────────────────────────────────────────────────────────────

describe("AN-25 review: money figures cover only fully recorded days", () => {
  // 20.10.2026, 12:00 Tashkent.
  const now = tashkent("2026-10-20", "12:00");
  const window = financialWindow(now);
  const refreshedAt = tashkent("2026-10-20", "11:00");
  const row = (day: string, collected: number) => ({
    clinicId: "c1",
    day: new Date(`${day}T00:00:00Z`),
    revenueCollectedTiins: BigInt(collected),
    revenueScheduledTiins: 100,
    noShowLossTiins: 10,
    refreshedAt,
  });
  // 1 000 collected every day of October through the 20th; the days before
  // recording began hold whatever was entered then.
  const rows = Array.from({ length: 20 }, (_, i) =>
    row(`2026-10-${String(i + 1).padStart(2, "0")}`, 1_000),
  );

  it("switched on 15.10 at 14:00: no month-to-date forecast, trend from 16.10", () => {
    const snap = buildFinancialSnapshot({
      rows,
      window,
      todayCollectedLiveTiins: 1_000,
      trackedSince: tashkent("2026-10-15", "14:00"),
      now,
    });
    expect(snap.measuredFrom).toBe("2026-10-16");
    // 16..20 October, five full days, not 20 days or a scaled month.
    expect(snap.mtd.collectedFrom).toBe("2026-10-16");
    expect(snap.mtd.revenueCollectedTiins).toBe(5_000);
    expect(snap.forecastMonthEndTiins).toBeNull();
    expect(snap.trendFrom).toBe("2026-10-16");
    const byDay = new Map(snap.daily.map((p) => [p.day, p.revenueCollectedTiins]));
    expect(byDay.get("2026-10-15")).toBeNull();
    expect(byDay.get("2026-10-01")).toBeNull();
    expect(byDay.get("2026-10-16")).toBe(1_000);
    // Visits booked and no-shows are not payments: the month keeps them.
    expect(snap.mtd.revenueScheduledTiins).toBe(2_000);
  });

  it("recorded since before the month: month-to-date and the forecast", () => {
    const snap = buildFinancialSnapshot({
      rows,
      window,
      todayCollectedLiveTiins: 1_000,
      trackedSince: tashkent("2026-10-01", "00:00"),
      now,
    });
    expect(snap.measuredFrom).toBe("2026-10-01");
    expect(snap.mtd.collectedFrom).toBe("2026-10-01");
    expect(snap.mtd.revenueCollectedTiins).toBe(20_000);
    expect(snap.forecastMonthEndTiins).toBe(31_000);
    // The trend starts with recording, which began inside its 90 days...
    expect(snap.trendFrom).toBe("2026-10-01");
    expect(snap.todayCollectedSince).toBeNull();
    // ...and at the window's own start once recording is older than it.
    const older = buildFinancialSnapshot({
      rows,
      window,
      todayCollectedLiveTiins: 1_000,
      trackedSince: tashkent("2026-06-01", "00:00"),
      now,
    });
    expect(older.trendFrom).toBe(window.from);
    expect(older.forecastMonthEndTiins).toBe(31_000);
  });

  it("switched on today: today counts from the switch, the month has no data yet", () => {
    const since = tashkent("2026-10-20", "10:15");
    const snap = buildFinancialSnapshot({
      rows,
      window,
      todayCollectedLiveTiins: 400,
      trackedSince: since,
      now,
    });
    expect(snap.todayCollectedSince).toBe(since.toISOString());
    expect(snap.mtd.revenueCollectedTiins).toBeNull();
    expect(snap.forecastMonthEndTiins).toBeNull();
    expect(snap.trendFrom).toBe("2026-10-21");
    expect(snap.today?.revenueCollectedTiins).toBeNull();
  });

  it("not recorded at all: no money figure anywhere", () => {
    const snap = buildFinancialSnapshot({
      rows,
      window,
      todayCollectedLiveTiins: null,
      trackedSince: null,
      now,
    });
    expect(snap.paymentsTracked).toBe(false);
    expect(snap.mtd.revenueCollectedTiins).toBeNull();
    expect(snap.forecastMonthEndTiins).toBeNull();
    expect(snap.trendFrom).toBeNull();
    expect(snap.daily.every((p) => p.revenueCollectedTiins === null)).toBe(true);
  });

  it("the live today figure is read from the switch on its first day", async () => {
    const since = tashkent("2026-10-20", "10:15");
    const wheres: Row[] = [];
    const db = {
      clinic: { findUnique: async () => ({ paymentsTrackedSince: since }) },
      payment: {
        aggregate: async ({ where }: { where: Row }) => {
          wheres.push(where);
          return { _sum: { amount: 400 } };
        },
      },
      $queryRawUnsafe: async () => rows,
    };
    const snap = await resolveFinancialPace(db as never, "c1", {}, now);
    expect((wheres[0]!.paidAt as { gte: Date }).gte).toEqual(since);
    expect(snap.todayCollectedLiveTiins).toBe(400);
  });

  it("the card shows the snapshot's forecast, never one scaled from a part month", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "src/app/[locale]/crm/analytics/financial/_components/financial-dashboard-client.tsx",
      "utf8",
    );
    expect(src).toContain("snapshot.forecastMonthEndTiins");
    expect(src).not.toContain("projection.projectedTiins");
    expect(src).toContain("from={snapshot.trendFrom}");
  });
});
