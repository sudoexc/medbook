/**
 * Phase 18 Wave 3 — `parseReportConfig` defensive validation.
 */
import { describe, it, expect } from "vitest";

import {
  parseReportConfig,
  safeParseReportConfig,
  resolveLimit,
  resolveDateRange,
  REPORT_LIMIT_DEFAULT,
  REPORT_LIMIT_MAX,
} from "@/server/analytics/report-config";

const VALID = {
  version: 1,
  dimensions: ["doctor"],
  measures: ["count_visits"],
  filters: {},
} as const;

describe("parseReportConfig", () => {
  it("accepts a minimal valid config", () => {
    const cfg = parseReportConfig(VALID);
    expect(cfg.dimensions).toEqual(["doctor"]);
    expect(cfg.measures).toEqual(["count_visits"]);
  });

  it("rejects an empty dimensions array", () => {
    expect(() =>
      parseReportConfig({ ...VALID, dimensions: [] }),
    ).toThrowError("InvalidReportConfig");
  });

  it("rejects an empty measures array", () => {
    expect(() =>
      parseReportConfig({ ...VALID, measures: [] }),
    ).toThrowError("InvalidReportConfig");
  });

  it("rejects more than 3 dimensions", () => {
    expect(() =>
      parseReportConfig({
        ...VALID,
        dimensions: ["doctor", "branch", "specialty", "date"],
      }),
    ).toThrowError("InvalidReportConfig");
  });

  it("rejects more than 5 measures", () => {
    expect(() =>
      parseReportConfig({
        ...VALID,
        measures: [
          "count_visits",
          "revenue_tiins",
          "no_show_rate",
          "avg_ticket_tiins",
          "ltv_tiins",
          "count_visits",
        ],
      }),
    ).toThrowError("InvalidReportConfig");
  });

  it("rejects an unknown dimension key", () => {
    expect(() =>
      parseReportConfig({ ...VALID, dimensions: ["bogus"] }),
    ).toThrowError("InvalidReportConfig");
  });

  it("rejects an unknown measure key", () => {
    expect(() =>
      parseReportConfig({ ...VALID, measures: ["bogus"] }),
    ).toThrowError("InvalidReportConfig");
  });

  it("rejects an invalid ISO date in filters.dateFrom", () => {
    expect(() =>
      parseReportConfig({
        ...VALID,
        filters: { dateFrom: "not-a-date" },
      }),
    ).toThrowError("InvalidReportConfig");
  });

  it("rejects an inverted date range", () => {
    expect(() =>
      parseReportConfig({
        ...VALID,
        filters: {
          dateFrom: "2026-05-10T00:00:00Z",
          dateTo: "2026-05-01T00:00:00Z",
        },
      }),
    ).toThrowError("InvalidReportConfig");
  });

  it("rejects limit below 1 and above max", () => {
    expect(() => parseReportConfig({ ...VALID, limit: 0 })).toThrow();
    expect(() =>
      parseReportConfig({ ...VALID, limit: REPORT_LIMIT_MAX + 1 }),
    ).toThrow();
  });

  it("rejects duplicate dimensions / measures", () => {
    expect(() =>
      parseReportConfig({ ...VALID, dimensions: ["doctor", "doctor"] }),
    ).toThrow();
    expect(() =>
      parseReportConfig({
        ...VALID,
        measures: ["count_visits", "count_visits"],
      }),
    ).toThrow();
  });

  it("safeParse returns ok=false with a populated issues list", () => {
    const r = safeParseReportConfig({ ...VALID, dimensions: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveLimit", () => {
  it("clamps to default when omitted", () => {
    expect(resolveLimit(parseReportConfig(VALID))).toBe(REPORT_LIMIT_DEFAULT);
  });
  it("respects user-set limits", () => {
    expect(resolveLimit(parseReportConfig({ ...VALID, limit: 25 }))).toBe(25);
  });
});

describe("resolveDateRange", () => {
  it("falls back to a 30-day window when filters omit dates", () => {
    const cfg = parseReportConfig(VALID);
    const now = new Date("2026-05-15T12:00:00Z");
    const r = resolveDateRange(cfg, now);
    const days =
      (r.dateTo.getTime() - r.dateFrom.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(30);
  });

  it("honours explicit dates", () => {
    const cfg = parseReportConfig({
      ...VALID,
      filters: {
        dateFrom: "2026-04-01T00:00:00Z",
        dateTo: "2026-04-15T00:00:00Z",
      },
    });
    const r = resolveDateRange(cfg, new Date("2026-05-01"));
    expect(r.dateFrom.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(r.dateTo.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });
});
