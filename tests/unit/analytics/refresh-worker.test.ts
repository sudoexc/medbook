/**
 * Phase 18 Wave 1 — analytics-refresh worker unit tests.
 *
 * Stubs the raw-SQL surface and asserts:
 *   - REFRESH is called for every MV in the canonical order.
 *   - A failure on one MV is logged but does NOT abort the rest.
 *   - First-refresh-after-WITH-NO-DATA falls back to non-CONCURRENT REFRESH.
 *   - Subsequent refreshes use CONCURRENTLY.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  ANALYTICS_MV_NAMES,
  type AnalyticsRefreshClient,
  refreshAllAnalyticsMvs,
  refreshOneMv,
} from "@/server/workers/analytics-refresh";

interface Stub {
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
  $executeRawUnsafe: ReturnType<typeof vi.fn>;
}

const asClient = (s: Stub) => s as unknown as AnalyticsRefreshClient;

function makeStub(opts: {
  populated?: boolean;
  rowCount?: number;
  failOn?: string[];
} = {}): Stub {
  const populated = opts.populated ?? true;
  const failOn = opts.failOn ?? [];
  const rowCount = opts.rowCount ?? 42;

  const $queryRawUnsafe = vi.fn(async (sql: string, ...args: unknown[]) => {
    if (sql.includes("relispopulated")) {
      return [{ relispopulated: populated }];
    }
    if (sql.includes("COUNT(*)")) {
      return [{ count: BigInt(rowCount) }];
    }
    return [];
  });

  const $executeRawUnsafe = vi.fn(async (sql: string) => {
    for (const name of failOn) {
      if (sql.includes(`"${name}"`)) {
        throw new Error(`simulated failure on ${name}`);
      }
    }
    return 1;
  });

  return { $queryRawUnsafe, $executeRawUnsafe };
}

describe("refreshOneMv", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("uses REFRESH MATERIALIZED VIEW (non-CONCURRENT) for unpopulated views", async () => {
    const stub = makeStub({ populated: false });
    await refreshOneMv(asClient(stub), "mv_doctor_performance");
    const sql = stub.$executeRawUnsafe.mock.calls[0]![0] as string;
    expect(sql).toBe(`REFRESH MATERIALIZED VIEW "mv_doctor_performance"`);
  });

  it("uses CONCURRENTLY for already-populated views", async () => {
    const stub = makeStub({ populated: true });
    await refreshOneMv(asClient(stub), "mv_cohort_retention");
    const sql = stub.$executeRawUnsafe.mock.calls[0]![0] as string;
    expect(sql).toBe(
      `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_cohort_retention"`,
    );
  });
});

describe("refreshAllAnalyticsMvs", () => {
  it("calls REFRESH for each MV in the declared order", async () => {
    const stub = makeStub();
    const result = await refreshAllAnalyticsMvs(asClient(stub));

    const refreshSqls = stub.$executeRawUnsafe.mock.calls.map(
      (c) => c[0] as string,
    );
    expect(refreshSqls).toHaveLength(ANALYTICS_MV_NAMES.length);
    for (let i = 0; i < ANALYTICS_MV_NAMES.length; i += 1) {
      expect(refreshSqls[i]).toContain(ANALYTICS_MV_NAMES[i]);
    }
    expect(result.failures).toEqual([]);
    expect(result.perView).toHaveLength(ANALYTICS_MV_NAMES.length);
  });

  it("does not abort when one view fails — remaining views still refresh", async () => {
    const stub = makeStub({ failOn: ["mv_cohort_retention"] });
    const result = await refreshAllAnalyticsMvs(asClient(stub));

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.name).toBe("mv_cohort_retention");
    // 4 MVs total → 3 successes + 1 failure.
    expect(result.perView).toHaveLength(3);
    // The failure does not skip the views after it.
    const refreshedNames = result.perView.map((v) => v.name);
    expect(refreshedNames).toContain("mv_financial_pace");
    expect(refreshedNames).toContain("mv_schedule_heatmap");
  });

  it("returns a totalMs >= sum of perView ms", async () => {
    const stub = makeStub();
    const result = await refreshAllAnalyticsMvs(asClient(stub));
    const sumPerView = result.perView.reduce((acc, v) => acc + v.ms, 0);
    expect(result.totalMs).toBeGreaterThanOrEqual(sumPerView);
  });
});
