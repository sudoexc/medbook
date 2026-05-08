/**
 * Phase 18 Wave 1 — query-builder unit tests.
 *
 * Pure-function tests: feed dimensions/measures/filters, assert the SQL
 * skeleton + parameter list. No Prisma, no Postgres.
 */
import { describe, it, expect } from "vitest";

import { buildAnalyticsQuery } from "@/server/analytics/query-builder";

const FROM = new Date("2026-04-01T00:00:00.000Z");
const TO = new Date("2026-05-01T00:00:00.000Z");

describe("buildAnalyticsQuery", () => {
  it("emits clinicId, date range, and soft-delete filter as the baseline WHERE", () => {
    const q = buildAnalyticsQuery({
      clinicId: "clinic_123",
      dimensions: ["doctor"],
      measures: ["count_visits"],
      filters: { dateFrom: FROM, dateTo: TO },
    });

    expect(q.sql).toContain(`a."clinicId" = $1`);
    expect(q.sql).toContain(`a."date" >= $2`);
    expect(q.sql).toContain(`a."date" <  $3`);
    expect(q.sql).toContain(`p."deletedAt" IS NULL`);
    expect(q.values[0]).toBe("clinic_123");
    expect(q.values[1]).toBe(FROM);
    expect(q.values[2]).toBe(TO);
  });

  it("renders dimension and measure SQL with stable aliases", () => {
    const q = buildAnalyticsQuery({
      clinicId: "c",
      dimensions: ["doctor"],
      measures: ["count_visits"],
      filters: { dateFrom: FROM, dateTo: TO },
    });

    expect(q.sql).toMatch(/a\."doctorId"\s+AS "doctorId"/);
    expect(q.sql).toMatch(/AS "countVisits"/);
    expect(q.columns).toEqual(["doctorId", "countVisits"]);
  });

  it("appends branchIds, doctorIds, and status filters as ANY(...)", () => {
    const q = buildAnalyticsQuery({
      clinicId: "c",
      dimensions: ["date"],
      measures: ["revenue_tiins"],
      filters: {
        dateFrom: FROM,
        dateTo: TO,
        branchIds: ["b1", "b2"],
        doctorIds: ["d1"],
        status: ["COMPLETED"],
      },
    });

    expect(q.sql).toContain(`a."branchId" = ANY($4::text[])`);
    expect(q.sql).toContain(`a."doctorId" = ANY($5::text[])`);
    expect(q.sql).toContain(`a."status"::text = ANY($6::text[])`);
    expect(q.values).toEqual([
      "c",
      FROM,
      TO,
      ["b1", "b2"],
      ["d1"],
      ["COMPLETED"],
    ]);
  });

  it("emits GROUP BY and ORDER BY for grouped queries", () => {
    const q = buildAnalyticsQuery({
      clinicId: "c",
      dimensions: ["doctor", "date"],
      measures: ["count_visits"],
      filters: { dateFrom: FROM, dateTo: TO },
    });
    expect(q.sql).toContain("GROUP BY");
    expect(q.sql).toContain("ORDER BY");
  });

  it("rejects unknown dimensions and measures", () => {
    expect(() =>
      buildAnalyticsQuery({
        clinicId: "c",
        dimensions: ["nope" as never],
        measures: ["count_visits"],
        filters: { dateFrom: FROM, dateTo: TO },
      }),
    ).toThrow(/Unknown dimension/);

    expect(() =>
      buildAnalyticsQuery({
        clinicId: "c",
        dimensions: ["doctor"],
        measures: ["bogus" as never],
        filters: { dateFrom: FROM, dateTo: TO },
      }),
    ).toThrow(/Unknown measure/);
  });

  it("requires at least one dimension or measure", () => {
    expect(() =>
      buildAnalyticsQuery({
        clinicId: "c",
        dimensions: [],
        measures: [],
        filters: { dateFrom: FROM, dateTo: TO },
      }),
    ).toThrow(/at least one/);
  });

  // Phase 18 W3 — covers a combination W1 didn't pin: 2 dims + 3 measures.
  // The W3 builder UI permits up to 3 dims + 5 measures; this exercise
  // confirms the SQL skeleton stays well-formed at a realistic mid-size
  // request and that all six aliases survive in `columns` + the SQL.
  it("emits a coherent skeleton for 2-dim + 3-measure (W3 typical shape)", () => {
    const q = buildAnalyticsQuery({
      clinicId: "c",
      dimensions: ["doctor", "date"],
      measures: ["count_visits", "revenue_tiins", "no_show_rate"],
      filters: { dateFrom: FROM, dateTo: TO },
    });
    // All six column aliases project.
    expect(q.columns).toEqual([
      "doctorId",
      "date",
      "countVisits",
      "revenueTiins",
      "noShowRate",
    ]);
    // GROUP/ORDER include both dimensions in declared order.
    expect(q.sql).toMatch(/GROUP BY[^]*doctorId[^]*date_trunc/);
    // Measures don't appear in GROUP BY.
    expect(q.sql).not.toMatch(/GROUP BY[^]*countVisits/);
    // Tenant + soft-delete filters survive.
    expect(q.sql).toContain(`a."clinicId" = $1`);
    expect(q.sql).toContain(`p."deletedAt" IS NULL`);
  });

  it("clamps limit into [1, 100_000]", () => {
    const q = buildAnalyticsQuery({
      clinicId: "c",
      dimensions: ["doctor"],
      measures: ["count_visits"],
      filters: { dateFrom: FROM, dateTo: TO },
      limit: 1_000_000,
    });
    expect(q.sql).toMatch(/LIMIT 100000/);

    const q2 = buildAnalyticsQuery({
      clinicId: "c",
      dimensions: ["doctor"],
      measures: ["count_visits"],
      filters: { dateFrom: FROM, dateTo: TO },
      limit: 0,
    });
    expect(q2.sql).toMatch(/LIMIT 1/);
  });
});
