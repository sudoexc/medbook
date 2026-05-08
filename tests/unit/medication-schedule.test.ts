/**
 * Phase 16 Wave 3 — pure-helper tests for the medication-reminder worker.
 *
 * No Prisma, no DB. We exercise the schedule parser, the "is-due" gate, the
 * next-tick computation, and the days-remaining accounting. Tashkent (UTC+5,
 * no DST) is the canonical clinic TZ in this codebase.
 */
import { describe, it, expect } from "vitest";

import {
  parseSchedule,
  isPrescriptionDueInWindow,
  nextTickAt,
  daysRemaining,
} from "@/lib/patient-experience/medication-schedule";

const TZ = "Asia/Tashkent";

describe("parseSchedule", () => {
  it("accepts a well-formed blob", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const out = parseSchedule(
      { times: ["09:00", "21:00"], days: 30, startsAt: start.toISOString() },
      start,
    );
    expect(out).not.toBeNull();
    expect(out!.times).toEqual(["09:00", "21:00"]);
    expect(out!.days).toBe(30);
    expect(out!.startsAt.toISOString()).toBe(start.toISOString());
  });

  it("filters bogus time strings", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const out = parseSchedule(
      { times: ["9am", "25:00", "10:60", "08:30"] },
      start,
    );
    expect(out!.times).toEqual(["08:30"]);
  });

  it("treats null `days` as open-ended", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const out = parseSchedule({ times: ["09:00"] }, start);
    expect(out!.days).toBeNull();
  });

  it("returns null for malformed input", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    expect(parseSchedule(null, start)).toBeNull();
    expect(parseSchedule("nope", start)).toBeNull();
    expect(parseSchedule({ times: [] }, start)).toBeNull();
    expect(parseSchedule({ times: "notarray" }, start)).toBeNull();
  });
});

describe("isPrescriptionDueInWindow", () => {
  it("matches the local hour and returns a UTC anchor", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const sched = parseSchedule(
      { times: ["09:00", "21:00"], days: 30, startsAt: start.toISOString() },
      start,
    )!;
    // 09:30 Tashkent on 2026-05-05 → 04:30 UTC
    const now = new Date("2026-05-05T04:30:00.000Z");
    const r = isPrescriptionDueInWindow(sched, now, TZ);
    expect(r).not.toBeNull();
    // Anchor is 09:00 Tashkent = 04:00 UTC
    expect(r!.dueAt.toISOString()).toBe("2026-05-05T04:00:00.000Z");
  });

  it("returns null if no scheduled time matches the current hour", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const sched = parseSchedule(
      { times: ["09:00", "21:00"], days: 30, startsAt: start.toISOString() },
      start,
    )!;
    // 13:00 Tashkent — neither 09 nor 21
    const now = new Date("2026-05-05T08:00:00.000Z");
    expect(isPrescriptionDueInWindow(sched, now, TZ)).toBeNull();
  });

  it("respects window start", () => {
    const start = new Date("2026-05-10T00:00:00.000Z");
    const sched = parseSchedule(
      { times: ["09:00"], days: 30, startsAt: start.toISOString() },
      start,
    )!;
    // Before startsAt
    const now = new Date("2026-05-05T04:30:00.000Z");
    expect(isPrescriptionDueInWindow(sched, now, TZ)).toBeNull();
  });

  it("respects window end (days exhausted)", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const sched = parseSchedule(
      { times: ["09:00"], days: 3, startsAt: start.toISOString() },
      start,
    )!;
    // Day 4 — past the window
    const now = new Date("2026-05-05T04:30:00.000Z");
    expect(isPrescriptionDueInWindow(sched, now, TZ)).toBeNull();
  });
});

describe("nextTickAt", () => {
  it("returns the next same-day tick if one exists", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const sched = parseSchedule(
      { times: ["09:00", "21:00"], startsAt: start.toISOString() },
      start,
    )!;
    // 12:00 Tashkent → next is 21:00 Tashkent same day = 16:00 UTC
    const from = new Date("2026-05-05T07:00:00.000Z");
    const next = nextTickAt(sched, from, TZ);
    expect(next!.toISOString()).toBe("2026-05-05T16:00:00.000Z");
  });

  it("rolls over to the next day past the last tick", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const sched = parseSchedule(
      { times: ["09:00", "21:00"], startsAt: start.toISOString() },
      start,
    )!;
    // 22:00 Tashkent → next is 09:00 Tashkent next day = 04:00 UTC next day
    const from = new Date("2026-05-05T17:00:00.000Z");
    const next = nextTickAt(sched, from, TZ);
    expect(next!.toISOString()).toBe("2026-05-06T04:00:00.000Z");
  });

  it("returns null past the schedule window", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const sched = parseSchedule(
      { times: ["09:00"], days: 1, startsAt: start.toISOString() },
      start,
    )!;
    const from = new Date("2026-05-03T07:00:00.000Z");
    expect(nextTickAt(sched, from, TZ)).toBeNull();
  });
});

describe("daysRemaining", () => {
  it("counts days until end", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const sched = parseSchedule(
      { times: ["09:00"], days: 30, startsAt: start.toISOString() },
      start,
    )!;
    const now = new Date("2026-05-10T00:00:00.000Z"); // 9 days in
    expect(daysRemaining(sched, now)).toBe(21);
  });

  it("returns null for open-ended schedules", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const sched = parseSchedule(
      { times: ["09:00"], startsAt: start.toISOString() },
      start,
    )!;
    expect(daysRemaining(sched, new Date())).toBeNull();
  });

  it("goes negative past the end", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const sched = parseSchedule(
      { times: ["09:00"], days: 3, startsAt: start.toISOString() },
      start,
    )!;
    const now = new Date("2026-05-10T00:00:00.000Z");
    expect(daysRemaining(sched, now)).toBeLessThanOrEqual(0);
  });
});
