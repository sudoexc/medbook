/**
 * Owner analytics correctness (audit AN-03 … AN-10, group «analytics-kpi»).
 *
 *   AN-03  «KPI врачей» for «30 дней» showed last month: the rollup is per
 *          calendar month and both bounds were cut to the month start.
 *   AN-04  30д → С начала года → 30д kept the year's rows under «30 дней».
 *   AN-05  «Средний LTV» was always 1 500 000 сум (midpoint keys never
 *          matched the buckets).
 *   AN-06  A doctor login with no Doctor row, or a forged branch cookie, got
 *          the clinic's revenue and every colleague's numbers.
 *   AN-07  The revenue chip and the no-show rate: equal windows, recorded
 *          payments only, resolved visits as the denominator.
 *   AN-09  Report builder: cuids, English «(tiins)» headers, ISO dates,
 *          ordering ignored, picked end day excluded.
 *   AN-10  The LTV measure summed DISTINCT values, not patients.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  doctorPerfQueryString,
  resolveDoctorPerfRange,
} from "@/lib/analytics/dashboard-math";
import { formatReportCell, formatReportDay } from "@/lib/analytics/report-cells";
import {
  DOCTOR_PERFORMANCE_SQL,
  resolveDoctorPerformance,
} from "@/server/analytics/doctor-performance-resolver";
import { averageLtv } from "@/server/analytics/ltv-summary";
import { MEASURES } from "@/server/analytics/measures";
import {
  isResolvedVisit,
  revenueDeltaPct,
} from "@/server/analytics/period-compare";
import { buildAnalyticsQuery } from "@/server/analytics/query-builder";
import {
  parseReportConfig,
  resolveDateRange,
} from "@/server/analytics/report-config";
import {
  buildReportColumns,
  localizeReportRows,
  runReport,
  type ReportRunnerClient,
} from "@/server/analytics/report-runner";
import { formatCsv } from "@/server/analytics/csv";

const state = vi.hoisted(() => ({
  role: "ADMIN" as string,
  branchId: undefined as string | undefined,
  doctorRow: null as null | { id: string },
  doctorLookupCtx: [] as Array<Record<string, unknown>>,
  trackedSince: null as Date | null,
  payments: [] as Array<{
    amount: number;
    paidAt: Date;
    appointmentId: string | null;
    appointment: { doctorId: string; serviceId: string | null } | null;
  }>,
  prevPaymentSum: 0,
  appts: [] as Array<{ date: Date; status: string }>,
  prevByStatus: [] as Array<{ status: string; _count: { _all: number } }>,
  ltvRow: {
    b0: BigInt(0),
    b1: BigInt(0),
    b2: BigInt(0),
    b3: BigInt(0),
    b4: BigInt(0),
    b5: BigInt(0),
    patients: BigInt(0),
    ltvSum: BigInt(0) as bigint | null,
  },
  rawCalls: [] as string[],
  patientGroupByArgs: [] as Array<Record<string, unknown>>,
  appointmentFindManyArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u1", role: state.role, clinicId: "c1", email: "o@x.t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(ctx: Record<string, unknown>, fn: () => T) => {
    state.doctorLookupCtx.push(ctx);
    return fn();
  },
  getTenant: () => ({
    kind: "TENANT",
    clinicId: "c1",
    userId: "u1",
    role: state.role,
    branchId: state.branchId,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => state.branchId ?? null,
}));
vi.mock("@/server/platform/feature-guard", () => ({
  ensureFeature: vi.fn(async () => null),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/analytics/clinic-load", () => ({
  loadClinicLoad: vi.fn(async () => ({
    daily: [],
    bookedMin: 0,
    workingMin: 0,
    loadPct: null,
    previous: { bookedMin: 0, workingMin: 0, loadPct: null },
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findFirst: vi.fn(async () => state.doctorRow),
      findMany: vi.fn(async () => []),
    },
    clinic: {
      findUnique: vi.fn(async () => ({ paymentsTrackedSince: state.trackedSince })),
    },
    payment: {
      findMany: vi.fn(async () => state.payments),
      aggregate: vi.fn(async () => ({ _sum: { amount: state.prevPaymentSum } })),
    },
    appointment: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        state.appointmentFindManyArgs.push(args);
        return state.appts;
      }),
      groupBy: vi.fn(async () => state.prevByStatus),
    },
    appointmentService: { findMany: vi.fn(async () => []) },
    service: { findMany: vi.fn(async () => []) },
    patient: {
      groupBy: vi.fn(async (args: Record<string, unknown>) => {
        state.patientGroupByArgs.push(args);
        return [];
      }),
    },
    conversation: { findMany: vi.fn(async () => []) },
    call: { findMany: vi.fn(async () => []) },
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      state.rawCalls.push(sql);
      return [state.ltvRow];
    }),
  },
}));

beforeEach(() => {
  state.role = "ADMIN";
  state.branchId = undefined;
  state.doctorRow = null;
  state.doctorLookupCtx = [];
  state.trackedSince = null;
  state.payments = [];
  state.prevPaymentSum = 0;
  state.appts = [];
  state.prevByStatus = [];
  state.ltvRow = {
    b0: BigInt(0),
    b1: BigInt(0),
    b2: BigInt(0),
    b3: BigInt(0),
    b4: BigInt(0),
    b5: BigInt(0),
    patients: BigInt(0),
    ltvSum: BigInt(0),
  };
  state.rawCalls = [];
  state.patientGroupByArgs = [];
  state.appointmentFindManyArgs = [];
});

const root = path.resolve(__dirname, "../..");
const source = (rel: string) =>
  readFileSync(path.join(root, rel), "utf8").replace(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    "",
  );
const tashkentMidnight = (ymd: string) => new Date(`${ymd}T00:00:00+05:00`);

// ── AN-03 ────────────────────────────────────────────────────────────────

describe("AN-03: «30 дней» in the doctor KPI includes the current month", () => {
  it("on 20.09 the 30-day window runs 22.08 to the end of 20.09 (Tashkent)", () => {
    const now = new Date("2026-09-20T07:00:00.000Z"); // 12:00 Tashkent
    const r = resolveDoctorPerfRange("30d", now);
    expect(r.from).toEqual(tashkentMidnight("2026-08-22"));
    expect(r.to).toEqual(tashkentMidnight("2026-09-21"));
  });

  it("between 00:00 and 05:00 Tashkent, today is already the Tashkent day", () => {
    // 01:30 on 20.09 in Tashkent is still 19.09 in UTC.
    const now = new Date("2026-09-19T20:30:00.000Z");
    expect(resolveDoctorPerfRange("30d", now).to).toEqual(
      tashkentMidnight("2026-09-21"),
    );
  });

  it("the resolver queries the exact window, not whole months", async () => {
    const calls: unknown[][] = [];
    const client = {
      $queryRawUnsafe: async <T,>(sql: string, ...values: unknown[]) => {
        calls.push([sql, ...values]);
        return [
          {
            doctorId: "d1",
            visitsCount: BigInt(12),
            revenueTiins: BigInt(180_000_000),
            noShowCount: BigInt(2),
            repeatVisitCount: BigInt(7),
            newPatientCount: BigInt(5),
            npsAvg: 9.5,
            npsCount: BigInt(4),
          },
        ] as unknown as T;
      },
    };
    const range = resolveDoctorPerfRange(
      "30d",
      new Date("2026-09-20T07:00:00.000Z"),
    );
    const out = await resolveDoctorPerformance(client, "c1", {
      from: range.from,
      to: range.to,
    });
    expect(calls[0]!.slice(1)).toEqual(["c1", range.from, range.to]);
    expect(out.rows).toEqual([
      {
        doctorId: "d1",
        visitsCount: 12,
        revenueTiins: 180_000_000,
        noShowCount: 2,
        repeatVisitCount: 7,
        newPatientCount: 5,
        npsAvg: 9.5,
        npsCount: 4,
      },
    ]);
  });

  it("reads Appointment with the window bounds, not the monthly rollup", () => {
    expect(DOCTOR_PERFORMANCE_SQL).not.toContain("mv_doctor_performance");
    expect(DOCTOR_PERFORMANCE_SQL).toMatch(/v\."date" >= \$2/);
    expect(DOCTOR_PERFORMANCE_SQL).toMatch(/a\."date" <  \$3/);
    // The visit ordinal looks at the whole history, not just the window.
    expect(DOCTOR_PERFORMANCE_SQL).toMatch(/PARTITION BY a\."doctorId", a\."patientId"/);
  });
});

// ── AN-04 ────────────────────────────────────────────────────────────────

describe("AN-04: every range selection loads its own rows", () => {
  const now = new Date("2026-09-20T07:00:00.000Z");

  it("30д → С начала года → 30д comes back to the 30-day query", () => {
    const first = doctorPerfQueryString("30d", now);
    const ytd = doctorPerfQueryString("ytd", now);
    const again = doctorPerfQueryString("30d", now);
    expect(first).not.toBeNull();
    expect(ytd).not.toEqual(first);
    expect(again).toEqual(first);
    const params = new URLSearchParams(first!);
    expect(params.get("from")).toBe(tashkentMidnight("2026-08-22").toISOString());
    expect(params.get("to")).toBe(tashkentMidnight("2026-09-21").toISOString());
  });

  it("an incomplete or inverted custom range fetches nothing", () => {
    expect(doctorPerfQueryString("custom", now, { from: "2026-09-01" })).toBeNull();
    expect(
      doctorPerfQueryString("custom", now, { from: "2026-09-10", to: "2026-09-01" }),
    ).toBeNull();
    expect(
      doctorPerfQueryString("custom", now, { from: "2026-09-10", to: "2026-09-10" }),
    ).not.toBeNull();
  });

  it("the table keys its query by the range, with no «already loaded» skip", () => {
    const code = source(
      "src/app/[locale]/crm/analytics/doctors/_components/doctor-performance-client.tsx",
    );
    expect(code).not.toMatch(/rangeKind === "30d"\) return/);
    expect(code).toMatch(/queryKey: \["analytics-doctor-performance", queryString\]/);
    // A failed fetch no longer leaves the previous range's rows on screen.
    expect(code).not.toContain("Stay on the previous payload");
  });
});

// ── AN-05 ────────────────────────────────────────────────────────────────

describe("AN-05: the average LTV is computed, not a constant", () => {
  it("is SUM(ltv) / patients, and null when nobody has paid", () => {
    expect(averageLtv({ patients: 4, ltvSum: 60_000_000 })).toEqual({
      averageTiins: 15_000_000,
      patients: 4,
    });
    expect(averageLtv({ patients: 4, ltvSum: 0 })).toEqual({
      averageTiins: null,
      patients: 4,
    });
    expect(averageLtv(null)).toEqual({ averageTiins: null, patients: 0 });
  });

  it("the dashboard returns it from the patients' LTV", async () => {
    state.ltvRow = {
      ...state.ltvRow,
      b0: BigInt(2),
      b1: BigInt(2),
      patients: BigInt(4),
      ltvSum: BigInt(30_000_000),
    };
    const { GET } = await import("@/app/api/crm/analytics/route");
    const res = await GET(new Request("https://x/api/crm/analytics?period=week"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ltv: { averageTiins: number | null; patients: number };
      ltvBuckets: Array<{ bucket: string; count: number }>;
    };
    expect(body.ltv).toEqual({ averageTiins: 7_500_000, patients: 4 });
    expect(body.ltvBuckets[0]).toEqual({ bucket: "0", count: 2 });
    expect(state.rawCalls[0]).toMatch(/"deletedAt" IS NULL/);
  });

  it("the chart no longer averages invented bucket midpoints", () => {
    const code = source("src/app/[locale]/crm/analytics/_components/analytics-charts.tsx");
    expect(code).not.toContain("midpoints");
    expect(code).not.toContain("1_500_000_00");
    expect(code).toContain("data.ltv?.averageTiins");
  });
});

// ── AN-06 ────────────────────────────────────────────────────────────────

describe("AN-06: the doctor filter fails closed", () => {
  it("a doctor login with no Doctor row gets 403 from the dashboard", async () => {
    state.role = "DOCTOR";
    state.doctorRow = null;
    const { GET } = await import("@/app/api/crm/analytics/route");
    const res = await GET(new Request("https://x/api/crm/analytics?period=quarter"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("DoctorProfileMissing");
    expect(state.appointmentFindManyArgs).toHaveLength(0);
  });

  it("and from the funnels", async () => {
    state.role = "DOCTOR";
    state.doctorRow = null;
    const { GET } = await import("@/app/api/crm/analytics/funnels/route");
    const res = await GET(new Request("https://x/api/crm/analytics/funnels?period=week"));
    expect(res.status).toBe(403);
  });

  it("the Doctor row is looked up without the (unsigned) branch cookie", async () => {
    state.role = "DOCTOR";
    state.branchId = "forged_branch";
    state.doctorRow = { id: "doc_1" };
    const { GET } = await import("@/app/api/crm/analytics/route");
    const res = await GET(new Request("https://x/api/crm/analytics?period=week"));
    expect(res.status).toBe(200);
    const lookup = state.doctorLookupCtx.at(-1)!;
    expect(lookup.branchId).toBeUndefined();
    expect(lookup.userId).toBe("u1");
  });

  it("a doctor gets their own slice: no clinic LTV, sources of their patients", async () => {
    state.role = "DOCTOR";
    state.doctorRow = { id: "doc_1" };
    const { GET } = await import("@/app/api/crm/analytics/route");
    const res = await GET(new Request("https://x/api/crm/analytics?period=week"));
    const body = (await res.json()) as {
      doctorOnly: boolean;
      ltvBuckets: unknown[];
      ltv: { averageTiins: number | null };
    };
    expect(body.doctorOnly).toBe(true);
    expect(body.ltvBuckets).toEqual([]);
    expect(body.ltv.averageTiins).toBeNull();
    expect(state.rawCalls).toHaveLength(0);
    expect(state.patientGroupByArgs[0]!.where).toMatchObject({
      appointments: { some: { doctorId: "doc_1" } },
    });
    expect(state.appointmentFindManyArgs[0]!.where).toMatchObject({ doctorId: "doc_1" });
  });

  it("the journey strip uses the same fail-closed lookup", () => {
    const code = source("src/app/api/crm/analytics/journey/route.ts");
    expect(code).toContain("resolveAnalyticsScope");
    expect(code).not.toMatch(/doctor\.findFirst/);
  });
});

// ── AN-07 ────────────────────────────────────────────────────────────────

describe("AN-07: equal windows, recorded payments, resolved visits", () => {
  const trackedSince = new Date("2026-01-01T00:00:00.000Z");
  const prevFrom = new Date("2026-09-15T19:00:00.000Z");

  it("a flat revenue over two equal weeks is 0 %", () => {
    expect(
      revenueDeltaPct({
        trackedSince,
        current: { amount: 7_000_000, payments: 7 },
        previous: { amount: 7_000_000, from: prevFrom },
      }),
    ).toBe(0);
  });

  it("no chip without recorded payments, or across the start of recording", () => {
    const current = { amount: 7_000_000, payments: 7 };
    const previous = { amount: 7_000_000, from: prevFrom };
    expect(revenueDeltaPct({ trackedSince: null, current, previous })).toBeNull();
    expect(
      revenueDeltaPct({ trackedSince, current: { amount: 0, payments: 0 }, previous }),
    ).toBeNull();
    expect(
      revenueDeltaPct({
        trackedSince: new Date("2026-09-18T00:00:00.000Z"),
        current,
        previous,
      }),
    ).toBeNull();
  });

  it("only COMPLETED and NO_SHOW are resolved visits", () => {
    expect(isResolvedVisit("COMPLETED")).toBe(true);
    expect(isResolvedVisit("NO_SHOW")).toBe(true);
    for (const s of ["BOOKED", "CONFIRMED", "WAITING", "IN_PROGRESS", "CANCELLED", "SKIPPED"]) {
      expect(isResolvedVisit(s)).toBe(false);
    }
  });

  it("the no-show rate leaves cancelled and not-yet-come visits out", async () => {
    const day = new Date();
    state.appts = [
      { date: day, status: "COMPLETED" },
      { date: day, status: "COMPLETED" },
      { date: day, status: "COMPLETED" },
      { date: day, status: "NO_SHOW" },
      { date: day, status: "CANCELLED" },
      { date: day, status: "BOOKED" },
      { date: day, status: "WAITING" },
    ];
    state.prevByStatus = [
      { status: "COMPLETED", _count: { _all: 1 } },
      { status: "NO_SHOW", _count: { _all: 1 } },
      { status: "CANCELLED", _count: { _all: 8 } },
    ];
    const { GET } = await import("@/app/api/crm/analytics/route");
    const res = await GET(new Request("https://x/api/crm/analytics?period=week"));
    const body = (await res.json()) as {
      noShowDaily: Array<{ total: number; noShow: number; rate: number }>;
      deltas: { noShowPp: number | null; revenuePct: number | null };
      paymentsTracked: boolean;
    };
    const today = body.noShowDaily.find((d) => d.total > 0)!;
    expect(today).toMatchObject({ total: 4, noShow: 1, rate: 0.25 });
    // 25 % now against 50 % before (1 of 2 resolved; the 8 cancelled don't count).
    expect(body.deltas.noShowPp).toBe(-25);
    expect(body.paymentsTracked).toBe(false);
    expect(body.deltas.revenuePct).toBeNull();
  });

  it("with payments recorded in both windows the chip compares them", async () => {
    state.trackedSince = trackedSince;
    state.payments = [
      { amount: 1_100_000, paidAt: new Date(), appointmentId: null, appointment: null },
    ];
    state.prevPaymentSum = 1_000_000;
    const { GET } = await import("@/app/api/crm/analytics/route");
    const res = await GET(new Request("https://x/api/crm/analytics?period=week"));
    const body = (await res.json()) as {
      deltas: { revenuePct: number | null };
      paymentsTracked: boolean;
    };
    expect(body.paymentsTracked).toBe(true);
    expect(body.deltas.revenuePct).toBe(10);
  });

  it("the money tiles say why instead of showing 0", () => {
    const code = source("src/app/[locale]/crm/analytics/_components/analytics-charts.tsx");
    expect(code).toContain("labels.noPayments");
    expect(code).toContain("labels.noData");
  });
});

// ── AN-09 ────────────────────────────────────────────────────────────────

describe("AN-09: the report builder speaks the reader's language", () => {
  it("headers are localized, money says сум, nothing says tiins", () => {
    const ru = buildReportColumns(
      ["doctor", "date"],
      ["count_visits", "revenue_tiins", "avg_ticket_tiins", "ltv_tiins", "no_show_rate"],
    );
    expect(ru.map((c) => c.label)).toEqual([
      "Врач",
      "Дата",
      "Визиты",
      "Выручка, сум",
      "Средний чек, сум",
      "LTV пациентов, сум",
      "Доля неявок",
    ]);
    expect(ru.find((c) => c.key === "date")!.unit).toBe("date");
    const uz = buildReportColumns(["branch"], ["revenue_tiins"], "uz");
    expect(uz.map((c) => c.label)).toEqual(["Filial", "Daromad, so‘m"]);
    for (const c of [...ru, ...uz]) expect(c.label).not.toMatch(/tiins/i);
  });

  it("doctors and branches are names, grouped by id", () => {
    const q = buildAnalyticsQuery({
      clinicId: "c",
      dimensions: ["doctor", "branch"],
      measures: ["count_visits"],
      filters: { dateFrom: new Date(0), dateTo: new Date(1) },
      locale: "uz",
    });
    expect(q.sql).toContain(`COALESCE(NULLIF(d."nameUz", ''), d."nameRu") AS "doctor"`);
    expect(q.sql).toContain(`LEFT JOIN "Branch" b ON b."id" = a."branchId"`);
    expect(q.sql).toMatch(/GROUP BY a\."doctorId", COALESCE\(NULLIF\(d\."nameUz"/);
    expect(q.sql).toContain(`a."branchId"`);
    expect(q.sql).not.toMatch(/a\."doctorId"\s+AS/);
  });

  it("ordering by a selected measure is applied; anything else is ignored", () => {
    const base = {
      clinicId: "c",
      dimensions: ["doctor"] as const,
      measures: ["revenue_tiins"] as const,
      filters: { dateFrom: new Date(0), dateTo: new Date(1) },
    };
    const byRevenue = buildAnalyticsQuery({
      ...base,
      dimensions: [...base.dimensions],
      measures: [...base.measures],
      ordering: { by: "revenue_tiins", direction: "desc" },
    });
    expect(byRevenue.sql).toMatch(/ORDER BY "revenueTiins" DESC NULLS LAST, d\."nameRu"/);
    const hostile = buildAnalyticsQuery({
      ...base,
      dimensions: [...base.dimensions],
      measures: [...base.measures],
      ordering: { by: `x"; DROP TABLE "Patient"; --`, direction: "asc" },
    });
    expect(hostile.sql).not.toContain("DROP");
    expect(hostile.sql).toMatch(/ORDER BY d\."nameRu"\nLIMIT/);
    const notSelected = buildAnalyticsQuery({
      ...base,
      dimensions: [...base.dimensions],
      measures: [...base.measures],
      ordering: { by: "count_visits", direction: "asc" },
    });
    expect(notSelected.sql).not.toContain(`"countVisits" ASC`);
  });

  it("the runner passes the ordering and localizes headers and codes", async () => {
    const seen: string[] = [];
    const client: ReportRunnerClient = {
      $queryRawUnsafe: async <T,>(sql: string) => {
        seen.push(sql);
        return [
          { patientSegment: "DORMANT", source: "KIOSK", countVisits: BigInt(3) },
          { patientSegment: "VIP", source: "unknown", countVisits: BigInt(1) },
          { patientSegment: "VIP", source: "INSTAGRAM", countVisits: BigInt(1) },
        ] as unknown as T;
      },
      $executeRawUnsafe: async () => 0,
      $transaction: async (fn) => fn(client),
    };
    const config = parseReportConfig({
      version: 1,
      dimensions: ["patient_segment", "source"],
      measures: ["count_visits"],
      ordering: { by: "count_visits", direction: "desc" },
    });
    const out = await runReport(client, "c1", config, new Date(), { locale: "ru" });
    expect(seen[0]).toMatch(/ORDER BY "countVisits" DESC NULLS LAST/);
    expect(out.columns.map((c) => c.label)).toEqual(["Сегмент пациента", "Источник", "Визиты"]);
    expect(out.rows.map((r) => [r.patientSegment, r.source])).toEqual([
      ["Остывает", "Киоск"],
      ["VIP", "Не указан"],
      ["VIP", "Instagram"],
    ]);
  });

  it("an unexpected code passes through untouched", () => {
    const out = localizeReportRows(
      [{ source: "FAX" }, { source: "toString", patientSegment: "constructor" }],
      ["source", "patient_segment"],
      "uz",
    );
    expect(out.map((r) => [r.source, r.patientSegment])).toEqual([
      ["FAX", undefined],
      ["toString", "constructor"],
    ]);
  });

  it("days print as ДД.ММ.ГГГГ in the table and the CSV", () => {
    const day = new Date("2026-09-22T00:00:00.000Z"); // Postgres ::date
    expect(formatReportDay(day)).toBe("22.09.2026");
    expect(formatReportDay("2026-09-22T00:00:00.000Z")).toBe("22.09.2026");
    expect(formatReportDay("2026-09-22")).toBe("22.09.2026");
    expect(formatReportCell("2026-09-22T00:00:00.000Z", "date", "ru")).toBe("22.09.2026");
    const csv = formatCsv(
      [
        { key: "date", label: "Дата", unit: "date" },
        { key: "revenueTiins", label: "Выручка, сум", unit: "tiins" },
      ],
      [{ date: day, revenueTiins: BigInt(15_000_000) }],
    );
    expect(csv).toContain("Дата,\"Выручка, сум\"");
    expect(csv).toContain("22.09.2026,150000.00");
  });

  it("picked days are Tashkent days and the end day is included", () => {
    const cfg = parseReportConfig({
      version: 1,
      dimensions: ["date"],
      measures: ["count_visits"],
      filters: { dateFrom: "2026-09-01", dateTo: "2026-09-30" },
    });
    expect(resolveDateRange(cfg)).toEqual({
      dateFrom: tashkentMidnight("2026-09-01"),
      dateTo: tashkentMidnight("2026-10-01"),
    });
  });
});

// ── AN-10 ────────────────────────────────────────────────────────────────

describe("AN-10: the LTV measure sums patients, not distinct values", () => {
  it("collects the group's distinct patients and sums each one's LTV once", () => {
    const sql = MEASURES.ltv_tiins.sql;
    expect(sql).not.toMatch(/SUM\(DISTINCT/);
    expect(sql).toMatch(/ARRAY_AGG\(DISTINCT a\."patientId"\)/);
    expect(sql).toMatch(/SUM\(lp\."ltv"\)/);
  });
});
