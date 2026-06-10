/**
 * P1.1 — visit-note-handout eligibility predicate.
 *
 * `hasDeliverableHandout` is the last gate before a clinical conclusion is
 * rendered for the patient, so its two rules are safety-critical and tested
 * exhaustively here without a database:
 *
 *   1. Only a FINALIZED note is ever deliverable — a DRAFT the doctor is still
 *      editing must never leak to the patient.
 *   2. The handout must carry real text — null / empty / whitespace-only is
 *      skipped (the sweep query already filters non-null, but an all-blank
 *      string survives that filter and must still be rejected).
 *
 * Note the predicate only ever looks at `patientHandoutMarkdown`; the clinical
 * `bodyMarkdown` is structurally absent from its input type, which is the
 * type-level half of the "never deliver bodyMarkdown" guarantee.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SLOT_TIMES,
  buildBridgeSchedule,
  hasDeliverableHandout,
  resolveSlotTimes,
} from "@/server/workers/visit-note-handout";

describe("hasDeliverableHandout", () => {
  it("is true for a FINALIZED note with real handout text", () => {
    expect(
      hasDeliverableHandout({
        status: "FINALIZED",
        patientHandoutMarkdown: "# Рекомендации\n- Пить воду",
      }),
    ).toBe(true);
  });

  it("is false for any non-FINALIZED status, even with a handout", () => {
    for (const status of ["DRAFT", "IN_PROGRESS", "ARCHIVED", ""]) {
      expect(
        hasDeliverableHandout({
          status,
          patientHandoutMarkdown: "# Памятка",
        }),
        `status=${status}`,
      ).toBe(false);
    }
  });

  it("is false when the handout is null", () => {
    expect(
      hasDeliverableHandout({
        status: "FINALIZED",
        patientHandoutMarkdown: null,
      }),
    ).toBe(false);
  });

  it("is false for an empty-string handout", () => {
    expect(
      hasDeliverableHandout({
        status: "FINALIZED",
        patientHandoutMarkdown: "",
      }),
    ).toBe(false);
  });

  it("is false for a whitespace-only handout (survives the not-null query filter)", () => {
    expect(
      hasDeliverableHandout({
        status: "FINALIZED",
        patientHandoutMarkdown: "   \n\t  ",
      }),
    ).toBe(false);
  });
});

/**
 * Ф6 — clinic slot-time resolution. `Clinic.medicationSlotTimes` is a Json
 * column edited by humans, so the resolver must treat it as hostile input:
 * anything that is not a valid HH:mm string for a known slot falls back to
 * the default, per slot, never wholesale.
 */
describe("resolveSlotTimes", () => {
  it("returns a copy of the defaults for null / undefined / non-object input", () => {
    for (const raw of [null, undefined, "08:00", 42, ["08:00"]]) {
      const out = resolveSlotTimes(raw);
      expect(out, `raw=${JSON.stringify(raw)}`).toEqual(DEFAULT_SLOT_TIMES);
      expect(out).not.toBe(DEFAULT_SLOT_TIMES);
    }
  });

  it("merges valid HH:mm overrides while keeping defaults for missing slots", () => {
    expect(resolveSlotTimes({ MORNING: "07:30", NIGHT: "21:45" })).toEqual({
      MORNING: "07:30",
      NOON: DEFAULT_SLOT_TIMES.NOON,
      EVENING: DEFAULT_SLOT_TIMES.EVENING,
      NIGHT: "21:45",
    });
  });

  it("ignores invalid values per slot without rejecting the rest", () => {
    expect(
      resolveSlotTimes({
        MORNING: "7:30", // missing leading zero
        NOON: "25:00", // hour out of range
        EVENING: "08:60", // minute out of range
        NIGHT: 2200, // not a string
      }),
    ).toEqual(DEFAULT_SLOT_TIMES);
    expect(
      resolveSlotTimes({ MORNING: "06:00", NOON: "lunch" }).MORNING,
    ).toBe("06:00");
  });

  it("ignores unknown slot keys", () => {
    expect(resolveSlotTimes({ MIDNIGHT: "00:00" })).toEqual(
      DEFAULT_SLOT_TIMES,
    );
  });
});

/**
 * Ф6 — bridge schedule shape. The reminder engine consumes `{times, days,
 * startsAt}`; times must come out in canonical day order regardless of how
 * the prescription row stored them.
 */
describe("buildBridgeSchedule", () => {
  const startsAt = new Date("2026-06-10T09:00:00.000Z");

  it("orders times canonically MORNING→NOON→EVENING→NIGHT regardless of input order", () => {
    const out = buildBridgeSchedule(
      { timesOfDay: ["NIGHT", "MORNING"], durationDays: 7 },
      { ...DEFAULT_SLOT_TIMES },
      startsAt,
    );
    expect(out.times).toEqual([
      DEFAULT_SLOT_TIMES.MORNING,
      DEFAULT_SLOT_TIMES.NIGHT,
    ]);
    expect(out.days).toBe(7);
  });

  it("maps slots through the resolved clinic times", () => {
    const out = buildBridgeSchedule(
      { timesOfDay: ["EVENING", "NOON"], durationDays: 10 },
      { ...DEFAULT_SLOT_TIMES, NOON: "12:30", EVENING: "18:15" },
      startsAt,
    );
    expect(out.times).toEqual(["12:30", "18:15"]);
  });

  it("passes durationDays through, null staying null (open-ended course)", () => {
    expect(
      buildBridgeSchedule(
        { timesOfDay: ["MORNING"], durationDays: null },
        { ...DEFAULT_SLOT_TIMES },
        startsAt,
      ).days,
    ).toBeNull();
  });

  it("serializes startsAt as an exact ISO string", () => {
    expect(
      buildBridgeSchedule(
        { timesOfDay: ["MORNING"], durationDays: 1 },
        { ...DEFAULT_SLOT_TIMES },
        startsAt,
      ).startsAt,
    ).toBe(startsAt.toISOString());
  });

  it("drops unknown slot strings instead of emitting undefined times", () => {
    const out = buildBridgeSchedule(
      { timesOfDay: ["BRUNCH", "MORNING"], durationDays: 3 },
      { ...DEFAULT_SLOT_TIMES },
      startsAt,
    );
    expect(out.times).toEqual([DEFAULT_SLOT_TIMES.MORNING]);
  });
});
