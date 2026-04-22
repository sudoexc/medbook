/**
 * Unit tests for `resolveAnalyticsRange` — the pure window-resolver used by
 * `/api/crm/analytics`. Covers the three named periods, explicit from/to,
 * and the inclusive-to → exclusive-to conversion.
 */
import { describe, expect, it } from "vitest";

import { resolveAnalyticsRange } from "@/server/analytics/range";

function urlWith(params: Record<string, string>): URL {
  const u = new URL("https://example.test/api/crm/analytics");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}

describe("resolveAnalyticsRange", () => {
  const NOW = new Date(2026, 3, 22, 15, 30); // Apr 22 2026 15:30 local

  it("defaults to 'month' (30-day window)", () => {
    const { from, to, period } = resolveAnalyticsRange(urlWith({}), NOW);
    expect(period).toBe("month");
    // to = tomorrow-at-midnight
    expect(to.getDate()).toBe(23);
    expect(to.getHours()).toBe(0);
    // from = 29 days before today-at-midnight
    const diffDays = Math.round(
      (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBe(30);
  });

  it("week = 7-day window ending at tomorrow-midnight", () => {
    const { from, to, period } = resolveAnalyticsRange(
      urlWith({ period: "week" }),
      NOW,
    );
    expect(period).toBe("week");
    const diffDays = Math.round(
      (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBe(7);
  });

  it("quarter = 90-day window", () => {
    const { from, to, period } = resolveAnalyticsRange(
      urlWith({ period: "quarter" }),
      NOW,
    );
    expect(period).toBe("quarter");
    const diffDays = Math.round(
      (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBe(90);
  });

  it("explicit from/to overrides the period and converts to exclusive upper bound", () => {
    const { from, to, period } = resolveAnalyticsRange(
      urlWith({ from: "2026-01-01", to: "2026-01-31", period: "week" }),
      NOW,
    );
    expect(period).toBe("custom");
    expect(from.getFullYear()).toBe(2026);
    expect(from.getMonth()).toBe(0);
    expect(from.getDate()).toBe(1);
    // inclusive 2026-01-31 → exclusive 2026-02-01
    expect(to.getMonth()).toBe(1);
    expect(to.getDate()).toBe(1);
  });

  it("ignores a partial explicit range (falls back to default month)", () => {
    const { period } = resolveAnalyticsRange(
      urlWith({ from: "2026-01-01" }), // no `to`
      NOW,
    );
    expect(period).toBe("month");
  });

  it("rejects malformed date strings and falls back", () => {
    const { period } = resolveAnalyticsRange(
      urlWith({ from: "not-a-date", to: "also-not" }),
      NOW,
    );
    expect(period).toBe("month");
  });

  it("from and to are both midnight-aligned", () => {
    const { from, to } = resolveAnalyticsRange(
      urlWith({ period: "week" }),
      NOW,
    );
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(from.getSeconds()).toBe(0);
    expect(to.getHours()).toBe(0);
    expect(to.getMinutes()).toBe(0);
    expect(to.getSeconds()).toBe(0);
  });
});
