/**
 * Unit tests for `resolveAnalyticsRange` — the pure window-resolver used by
 * `/api/crm/analytics`. Covers the three named periods, explicit from/to,
 * and the inclusive-to → exclusive-to conversion.
 *
 * Day boundaries are **Tashkent** (clinic time, UTC+5) — the assertions pin
 * UTC instants (`…T19:00:00Z` = Tashkent midnight) so the suite passes
 * identically on a UTC prod box and a UTC+5 dev machine.
 */
import { describe, expect, it } from "vitest";

import { resolveAnalyticsRange, ymdKey } from "@/server/analytics/range";

function urlWith(params: Record<string, string>): URL {
  const u = new URL("https://example.test/api/crm/analytics");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}

// Apr 22 2026 15:30 Tashkent (= 10:30Z). Same civil date in UTC and Tashkent.
const NOW = new Date("2026-04-22T10:30:00Z");

describe("resolveAnalyticsRange", () => {
  it("defaults to 'month' (30-day window)", () => {
    const { from, to, period } = resolveAnalyticsRange(urlWith({}), NOW);
    expect(period).toBe("month");
    // to = tomorrow-at-midnight Tashkent = Apr 22 19:00Z
    expect(to.toISOString()).toBe("2026-04-22T19:00:00.000Z");
    const diffDays = Math.round(
      (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBe(30);
  });

  it("week = 7-day window ending at tomorrow-midnight (Tashkent)", () => {
    const { from, to, period } = resolveAnalyticsRange(
      urlWith({ period: "week" }),
      NOW,
    );
    expect(period).toBe("week");
    const diffDays = Math.round(
      (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBe(7);
    // from = Apr 16 00:00 Tashkent = Apr 15 19:00Z
    expect(from.toISOString()).toBe("2026-04-15T19:00:00.000Z");
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
    // 2026-01-01 as a Tashkent day starts at 2025-12-31T19:00Z.
    expect(from.toISOString()).toBe("2025-12-31T19:00:00.000Z");
    // inclusive 2026-01-31 → exclusive 2026-02-01 00:00 Tashkent
    expect(to.toISOString()).toBe("2026-01-31T19:00:00.000Z");
    expect(ymdKey(from)).toBe("2026-01-01");
    expect(ymdKey(to)).toBe("2026-02-01");
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

  it("from and to are both Tashkent-midnight-aligned (=19:00Z)", () => {
    const { from, to } = resolveAnalyticsRange(
      urlWith({ period: "week" }),
      NOW,
    );
    expect(from.getUTCHours()).toBe(19);
    expect(from.getUTCMinutes()).toBe(0);
    expect(from.getUTCSeconds()).toBe(0);
    expect(to.getUTCHours()).toBe(19);
    expect(to.getUTCMinutes()).toBe(0);
    expect(to.getUTCSeconds()).toBe(0);
  });

  it("late Tashkent evening (after 19:00Z) still resolves the clinic's civil day", () => {
    // 2026-04-22 21:00Z = 2026-04-23 02:00 Tashkent — the clinic is already
    // living in Apr 23 while the server's UTC date is still Apr 22.
    const late = new Date("2026-04-22T21:00:00Z");
    const { to } = resolveAnalyticsRange(urlWith({ period: "week" }), late);
    // "today" = Apr 23 (Tashkent), so exclusive to = Apr 24 00:00 Tashkent.
    expect(to.toISOString()).toBe("2026-04-23T19:00:00.000Z");
  });
});
