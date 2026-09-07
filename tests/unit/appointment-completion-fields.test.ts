/**
 * Closing a visit must move BOTH status columns.
 *
 * Found in production during the clinic's first test drive: the doctor
 * finished a visit, `status` became COMPLETED — and the reception board kept
 * showing him as «На приёме» with an empty queue underneath. `finalize` wrote
 * only `status`, while reception reads `queueStatus`. Worse, the realtime
 * outbox only emits a queue update when `queueStatus` actually changes, so no
 * event ever arrived to correct the board: the front desk stayed wrong until a
 * manual reload, and even then re-read the same stale column.
 *
 * These tests pin the pair together, plus the endDate shrink that frees the
 * unused tail of an early-finished slot for re-booking.
 */
import { describe, expect, it } from "vitest";

import { completionFields } from "@/server/appointments/completion";

const START = new Date("2026-09-07T07:00:00.000Z");
const END = new Date("2026-09-07T07:30:00.000Z"); // 30-minute slot

describe("completionFields — both status columns move together", () => {
  it("sets status AND queueStatus to COMPLETED", () => {
    const f = completionFields({
      now: new Date("2026-09-07T07:20:00.000Z"),
      date: START,
      endDate: END,
    });
    expect(f.status).toBe("COMPLETED");
    // The regression: reception reads this column and was left on IN_PROGRESS.
    expect(f.queueStatus).toBe("COMPLETED");
    expect(f.status).toBe(f.queueStatus);
  });

  it("keeps the pair in sync no matter when the visit ends", () => {
    for (const iso of [
      "2026-09-07T07:00:30.000Z", // instantly
      "2026-09-07T07:15:00.000Z", // halfway
      "2026-09-07T07:30:00.000Z", // exactly on time
      "2026-09-07T09:00:00.000Z", // long overrun
    ]) {
      const f = completionFields({ now: new Date(iso), date: START, endDate: END });
      expect(f.queueStatus).toBe(f.status);
      expect(f.queueStatus).toBe("COMPLETED");
    }
  });

  it("stamps completedAt with the moment of closing", () => {
    const now = new Date("2026-09-07T07:20:00.000Z");
    expect(completionFields({ now, date: START, endDate: END }).completedAt).toEqual(now);
  });
});

describe("completionFields — endDate shrink frees the unused tail", () => {
  it("shrinks endDate to now when the doctor finishes early", () => {
    const now = new Date("2026-09-07T07:12:00.000Z");
    const f = completionFields({ now, date: START, endDate: END });
    expect(f.endDate).toEqual(now);
    expect(f.durationMin).toBe(12);
  });

  it("never shrinks below a 5-minute floor", () => {
    // A 40-second visit would otherwise produce a 1-minute (or 0-minute) slot.
    const f = completionFields({
      now: new Date("2026-09-07T07:00:40.000Z"),
      date: START,
      endDate: END,
    });
    expect(f.durationMin).toBe(5);
    expect(f.endDate).toEqual(new Date("2026-09-07T07:05:00.000Z"));
  });

  it("leaves the booked end alone when the visit runs over", () => {
    const f = completionFields({
      now: new Date("2026-09-07T08:10:00.000Z"),
      date: START,
      endDate: END,
    });
    expect(f.endDate).toEqual(END);
    expect(f.durationMin).toBe(30);
  });

  it("leaves the booked end alone when finished exactly on time", () => {
    const f = completionFields({ now: END, date: START, endDate: END });
    expect(f.endDate).toEqual(END);
    expect(f.durationMin).toBe(30);
  });
});
