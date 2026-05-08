/**
 * Phase 17 Wave 2 — session-security pure helpers.
 *
 * Tests the lifetime predicate and the kick-list builder. No DB / no Date
 * shenanigans (we pass `now` explicitly).
 */
import { describe, it, expect } from "vitest";

import {
  checkSessionLifetime,
  clampIdleMinutes,
  FORCED_REROTATE_MS,
  IDLE_TIMEOUT_DEFAULT,
  IDLE_TIMEOUT_MAX,
  IDLE_TIMEOUT_MIN,
  pickSessionsToKick,
} from "@/server/auth/session-security";

const MIN_MS = 60 * 1000;

describe("clampIdleMinutes", () => {
  it("returns the value when in range", () => {
    expect(clampIdleMinutes(45)).toBe(45);
  });
  it("clamps below the floor", () => {
    expect(clampIdleMinutes(2)).toBe(IDLE_TIMEOUT_MIN);
  });
  it("clamps above the ceiling", () => {
    expect(clampIdleMinutes(9999)).toBe(IDLE_TIMEOUT_MAX);
  });
  it("falls back to the default for non-finite", () => {
    expect(clampIdleMinutes(Number.NaN)).toBe(IDLE_TIMEOUT_DEFAULT);
    expect(clampIdleMinutes(Number.POSITIVE_INFINITY)).toBe(
      IDLE_TIMEOUT_DEFAULT,
    );
  });
  it("floors fractional input", () => {
    expect(clampIdleMinutes(45.7)).toBe(45);
  });
});

describe("checkSessionLifetime — idle", () => {
  const now = new Date("2026-05-07T12:00:00Z");

  it("returns null when within idle window", () => {
    const verdict = checkSessionLifetime({
      lastActivityAt: new Date(now.getTime() - 5 * MIN_MS),
      lastSessionRotatedAt: new Date(now.getTime() - 60 * MIN_MS),
      sessionCreatedAt: new Date(now.getTime() - 60 * MIN_MS),
      idleTimeoutMinutes: 30,
      now,
    });
    expect(verdict).toBeNull();
  });

  it("returns 'idle' when lastActivityAt exceeds the configured window", () => {
    const verdict = checkSessionLifetime({
      lastActivityAt: new Date(now.getTime() - 31 * MIN_MS),
      lastSessionRotatedAt: new Date(now.getTime() - 60 * MIN_MS),
      sessionCreatedAt: new Date(now.getTime() - 60 * MIN_MS),
      idleTimeoutMinutes: 30,
      now,
    });
    expect(verdict).toBe("idle");
  });

  it("clamps an out-of-bound idle setting to the safe range", () => {
    // 99999 should clamp to IDLE_TIMEOUT_MAX (240); a 4h-old activity is still
    // within that ceiling and must NOT trip idle.
    const verdict = checkSessionLifetime({
      lastActivityAt: new Date(now.getTime() - 230 * MIN_MS),
      lastSessionRotatedAt: now,
      sessionCreatedAt: now,
      idleTimeoutMinutes: 99999,
      now,
    });
    expect(verdict).toBeNull();
  });
});

describe("checkSessionLifetime — forced rerotate", () => {
  const now = new Date("2026-05-07T12:00:00Z");

  it("returns 'forced-rerotate' when rotation anchor is older than 8h", () => {
    const old = new Date(now.getTime() - (FORCED_REROTATE_MS + 60_000));
    const verdict = checkSessionLifetime({
      lastActivityAt: now,
      lastSessionRotatedAt: old,
      sessionCreatedAt: old,
      idleTimeoutMinutes: 30,
      now,
    });
    expect(verdict).toBe("forced-rerotate");
  });

  it("uses sessionCreatedAt as anchor when lastSessionRotatedAt is null", () => {
    const old = new Date(now.getTime() - (FORCED_REROTATE_MS + 60_000));
    const verdict = checkSessionLifetime({
      lastActivityAt: now,
      lastSessionRotatedAt: null,
      sessionCreatedAt: old,
      idleTimeoutMinutes: 30,
      now,
    });
    expect(verdict).toBe("forced-rerotate");
  });

  it("a fresh, never-rotated session is alive", () => {
    const verdict = checkSessionLifetime({
      lastActivityAt: now,
      lastSessionRotatedAt: null,
      sessionCreatedAt: new Date(now.getTime() - 10 * MIN_MS),
      idleTimeoutMinutes: 30,
      now,
    });
    expect(verdict).toBeNull();
  });

  it("idle takes precedence over forced-rerotate when both trip", () => {
    const old = new Date(now.getTime() - (FORCED_REROTATE_MS + 60_000));
    const verdict = checkSessionLifetime({
      lastActivityAt: new Date(now.getTime() - 60 * MIN_MS),
      lastSessionRotatedAt: old,
      sessionCreatedAt: old,
      idleTimeoutMinutes: 30,
      now,
    });
    expect(verdict).toBe("idle");
  });
});

describe("pickSessionsToKick", () => {
  it("returns [] when there are no prior sessions", () => {
    expect(pickSessionsToKick([])).toEqual([]);
  });

  it("returns ALL prior session IDs (a fresh login becomes the only session)", () => {
    const rows = [
      { id: "a", createdAt: new Date("2026-05-07T10:00:00Z") },
      { id: "b", createdAt: new Date("2026-05-07T11:00:00Z") },
      { id: "c", createdAt: new Date("2026-05-07T09:00:00Z") },
    ];
    const kicked = pickSessionsToKick(rows);
    expect(kicked.sort()).toEqual(["a", "b", "c"]);
  });

  it("does NOT mutate the caller's rows array", () => {
    const rows = [
      { id: "a", createdAt: new Date("2026-05-07T10:00:00Z") },
      { id: "b", createdAt: new Date("2026-05-07T11:00:00Z") },
    ];
    const before = rows.map((r) => r.id);
    pickSessionsToKick(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});
