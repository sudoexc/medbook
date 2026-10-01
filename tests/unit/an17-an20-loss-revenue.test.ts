/**
 * P5 analytics, the DB-reading side (audit AN-17, AN-18, AN-20):
 *   - AN-17: the loss dashboard reports dormant patients as a stock beside
 *     the period, by `lastVisitAt`; a visit after the lapse clears
 *     `dormantSince`;
 *   - AN-18: the scheduled-report worker runs the cadence's window and
 *     names it; a clinic without a Telegram bot is not «delivered»;
 *   - AN-20: /api/crm/dashboard gives revenue only to the finance roles
 *     and, with a branch selected, only that branch's visits' payments.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: "ADMIN" } as Record<string, unknown>,
  trackedSince: null as Date | null,
  lapsed: [] as Array<{ id: string; lastVisitAt: Date }>,
  upcomingPatientIds: [] as string[],
  lossAppts: [] as Row[],
  activeCount: 0,
  payments: [] as Array<{ amount: number }>,
  paymentAggWheres: [] as Row[],
  patientUpdates: [] as Array<{ where: Row; data: Row }>,
  completedAt: null as Date | null,
  completedCount: 0,
  savedReport: null as Row | null,
  clinicBot: null as string | null,
  runReportConfigs: [] as Row[],
  sentDocuments: 0,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => h.ctx,
}));

vi.mock("@/lib/api-handler", () => ({
  createApiListHandler:
    (_opts: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    (request: Request) =>
      handler({ request, ctx: h.ctx }),
}));

vi.mock("@/server/revenue/avg-visit", () => ({
  getClinicAvgVisitTiins: async () => 0,
}));

vi.mock("@/server/telegram/send", () => ({
  sendDocument: vi.fn(async () => {
    h.sentDocuments += 1;
    return { message_id: 1 };
  }),
}));

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
    emptySlotSnapshot: { findMany: vi.fn(async () => []) },
    appointment: {
      findMany: vi.fn(async ({ where }: { where: { status: { in: string[] } } }) => {
        if (where.status.in.includes("NO_SHOW")) return h.lossAppts;
        return h.upcomingPatientIds.map((patientId) => ({ patientId }));
      }),
      count: vi.fn(async () => h.completedCount),
      findFirst: vi.fn(async ({ where }: { where: { completedAt?: unknown } }) =>
        where.completedAt && h.completedAt ? { completedAt: h.completedAt } : null,
      ),
      groupBy: vi.fn(async () => []),
    },
    service: { findMany: vi.fn(async () => []) },
    patient: {
      findMany: vi.fn(async () => h.lapsed),
      count: vi.fn(async () => h.activeCount),
      updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
        h.patientUpdates.push(args);
        return { count: 1 };
      }),
    },
    payment: {
      findMany: vi.fn(async () => h.payments),
      aggregate: vi.fn(async ({ where }: { where: Row }) => {
        h.paymentAggWheres.push(where);
        return { _sum: { amount: 12_345 } };
      }),
    },
    doctor: { findMany: vi.fn(async () => []) },
    clinic: {
      findUnique: vi.fn(async () => ({
        id: "c1",
        slug: "neurofax",
        paymentsTrackedSince: h.trackedSince,
        tgBotToken: h.clinicBot,
        tgBotUsername: null,
      })),
    },
    call: { count: vi.fn(async () => 0) },
    lead: { count: vi.fn(async () => 0) },
    savedReport: { findFirst: vi.fn(async () => h.savedReport) },
    scheduledReport: { update: vi.fn(async () => ({})) },
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));

import { loadLossDashboard } from "@/server/revenue/loss-data";
import { summarizeDormantStock } from "@/lib/revenue/loss-aggregation";
import { refreshPatientVisitStats } from "@/server/patient/last-contacted";
import { GET as dashboardGET } from "@/app/api/crm/dashboard/route";
import { processSchedule } from "@/server/workers/scheduled-reports";
import { deliverTelegram } from "@/server/analytics/delivery";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T06:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

beforeEach(() => {
  h.ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "ADMIN" };
  h.trackedSince = null;
  h.lapsed = [];
  h.upcomingPatientIds = [];
  h.lossAppts = [];
  h.activeCount = 0;
  h.payments = [];
  h.paymentAggWheres = [];
  h.patientUpdates = [];
  h.completedAt = null;
  h.completedCount = 0;
  h.savedReport = null;
  h.clinicBot = null;
  h.runReportConfigs = [];
  h.sentDocuments = 0;
});

// ── AN-17 ────────────────────────────────────────────────────────────────

describe("AN-17: dormant patients are a stock, not a loss of the period", () => {
  const from = new Date("2026-09-27T19:00:00Z"); // Monday 28.09, Tashkent
  const to = new Date("2026-10-04T19:00:00Z");

  it("the week's total and chart hold no dormant value", async () => {
    h.lapsed = [
      { id: "p1", lastVisitAt: daysAgo(200) },
      { id: "p2", lastVisitAt: daysAgo(100) },
    ];
    h.upcomingPatientIds = ["p2"]; // booked again: not dormant
    h.lossAppts = [
      {
        id: "a1",
        date: new Date("2026-09-29T05:00:00Z"),
        status: "NO_SHOW",
        cancelledAt: null,
        updatedAt: new Date("2026-09-29T05:00:00Z"),
        doctorId: "d1",
        priceFinal: 50_000_00,
        primaryService: null,
      },
    ];
    const data = await loadLossDashboard("c1", from, to, NOW);
    expect(data.totals).toEqual({ emptySlot: 0, noShow: 50_000_00, cancellation: 0, total: 50_000_00 });
    expect(data.daily[0]).not.toHaveProperty("dormant");
    expect(data.daily.reduce((s, d) => s + d.noShow, 0)).toBe(50_000_00);
    expect(data.dormant.patientCount).toBe(1);
    expect(data.dormant.segments.find((s) => s.segment === "mid_lapse")?.patientCount).toBe(1);
  });

  it("without payments recorded for 90 days there is no money estimate", async () => {
    h.lapsed = [{ id: "p1", lastVisitAt: daysAgo(120) }];
    h.payments = [{ amount: 900_000 }];
    h.activeCount = 3;
    const off = await loadLossDashboard("c1", from, to, NOW);
    expect(off.averageVisitValueUzs).toBeNull();
    expect(off.dormant.estimatedRevenueUzs).toBeNull();

    h.trackedSince = daysAgo(30); // recording, but not the whole 90 days
    expect((await loadLossDashboard("c1", from, to, NOW)).dormant.estimatedRevenueUzs).toBeNull();

    h.trackedSince = daysAgo(200);
    const on = await loadLossDashboard("c1", from, to, NOW);
    expect(on.averageVisitValueUzs).toBe(300_000);
    expect(on.dormant.estimatedRevenueUzs).toBe(300_000);
  });

  it("the patient's last visit decides, not a stale dormantSince", () => {
    const stock = summarizeDormantStock([daysAgo(10), daysAgo(95), daysAgo(400)], NOW, null);
    expect(stock.patientCount).toBe(2);
    expect(stock.segments.map((s) => [s.segment, s.patientCount])).toEqual([
      ["recent_lapse", 1],
      ["mid_lapse", 0],
      ["deep_lapse", 1],
    ]);
  });

  it("a completed visit after the lapse began clears dormantSince", async () => {
    h.completedCount = 4;
    h.completedAt = new Date("2026-09-30T07:00:00Z");
    await refreshPatientVisitStats("p1");
    expect(h.patientUpdates[1]).toEqual({
      where: { id: "p1", dormantSince: { lte: h.completedAt } },
      data: { dormantSince: null },
    });
  });

  it("with no completed visit left, dormantSince is not touched", async () => {
    await refreshPatientVisitStats("p1");
    expect(h.patientUpdates).toHaveLength(1);
    expect(h.patientUpdates[0]!.data).toEqual({ visitsCount: 0, lastVisitAt: null });
  });
});

// ── AN-18 ────────────────────────────────────────────────────────────────

describe("AN-18: a daily schedule sends yesterday, named in the subject", () => {
  it("24.09 runs 23.09 only, whatever dates the report saved", async () => {
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
        nextRunAt: new Date("2026-09-24T04:00:00Z"), // 09:00 Tashkent
        deliveryChannel: "EMAIL",
        deliveryTarget: "owner@clinic.uz",
        format: "csv",
        consecutiveFailures: 0,
        enabled: true,
      },
      { deliver, now: () => new Date("2026-09-24T04:03:00Z") },
    );
    expect(r.ok).toBe(true);
    const filters = (h.runReportConfigs[0] as { filters: Row }).filters;
    expect(filters).toMatchObject({ dateFrom: "2026-09-23", dateTo: "2026-09-23" });
    const payload = (deliver.mock.calls[0] as unknown as [{ payload: Row }])[0].payload;
    expect(payload.subject).toBe("Выручка: отчёт за 23.09.2026");
    expect(payload.summary).toContain("Период: 23.09.2026");
    expect(String(payload.subject)).not.toMatch(/[—–]/);
  });

  it("a clinic without a Telegram bot is a failure, not a delivery", async () => {
    const r = await deliverTelegram("c1", {
      filename: "r.csv",
      contentType: "text/csv",
      body: Buffer.from("x"),
      recipient: "12345",
      subject: "s",
      summary: "",
    });
    expect(r.ok).toBe(false);
    expect(h.sentDocuments).toBe(0);
  });
});

// ── AN-20 ────────────────────────────────────────────────────────────────

describe("AN-20: dashboard revenue is for finance roles, per branch", () => {
  const call = async () => {
    const res = await dashboardGET(new Request("http://x/api/crm/dashboard"));
    return (await res.json()) as {
      today: { revenue: number | null };
      month: { revenue: number | null };
    };
  };

  it.each(["DOCTOR", "CALL_OPERATOR", "RECEPTIONIST"])("%s gets no revenue", async (role) => {
    h.ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role };
    const body = await call();
    expect(body.today.revenue).toBeNull();
    expect(body.month.revenue).toBeNull();
    expect(h.paymentAggWheres).toHaveLength(0);
  });

  it("an admin gets it clinic-wide, or for the selected branch's visits", async () => {
    expect((await call()).today.revenue).toBe(12_345);
    expect(h.paymentAggWheres[0]).not.toHaveProperty("appointment");

    h.paymentAggWheres = [];
    h.ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "ADMIN", branchId: "b1" };
    await call();
    expect(h.paymentAggWheres).toHaveLength(3);
    for (const w of h.paymentAggWheres) {
      expect(w).toMatchObject({ status: "PAID", appointment: { branchId: "b1" } });
    }
  });
});
