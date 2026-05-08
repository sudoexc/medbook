/**
 * Phase 12 Wave 3 — `src/lib/calendar/reschedule-math.ts`
 *
 * The drag-drop reschedule path leans on this pure helper to derive the
 * new (start, end) pair. The client must preserve the original duration
 * (drag only chooses a start) and short-circuit the "in the past" case
 * before hitting the server. These tests pin both behaviours.
 */
import { describe, it, expect } from "vitest";

import { computeRescheduledSlot } from "@/lib/calendar/reschedule-math";

describe("computeRescheduledSlot", () => {
  const NOW = new Date("2026-05-06T08:00:00.000Z");

  it("preserves the original duration when moving forward", () => {
    const r = computeRescheduledSlot({
      originalStart: new Date("2026-05-06T09:00:00.000Z"),
      originalEnd: new Date("2026-05-06T09:30:00.000Z"),
      newStart: new Date("2026-05-06T11:00:00.000Z"),
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.durationMin).toBe(30);
    expect(r.newStartIso).toBe("2026-05-06T11:00:00.000Z");
    expect(r.newEndIso).toBe("2026-05-06T11:30:00.000Z");
  });

  it("preserves a 60-min duration across days", () => {
    const r = computeRescheduledSlot({
      originalStart: new Date("2026-05-06T10:00:00.000Z"),
      originalEnd: new Date("2026-05-06T11:00:00.000Z"),
      newStart: new Date("2026-05-07T14:30:00.000Z"),
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.durationMin).toBe(60);
    expect(r.newEndIso).toBe("2026-05-07T15:30:00.000Z");
  });

  it("propagates the new doctor id when columns differ", () => {
    const r = computeRescheduledSlot({
      originalStart: new Date("2026-05-06T09:00:00.000Z"),
      originalEnd: new Date("2026-05-06T09:30:00.000Z"),
      newStart: new Date("2026-05-06T10:00:00.000Z"),
      newDoctorId: "doc-2",
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newDoctorId).toBe("doc-2");
  });

  it("rejects drops landing in the past", () => {
    const r = computeRescheduledSlot({
      originalStart: new Date("2026-05-06T09:00:00.000Z"),
      originalEnd: new Date("2026-05-06T09:30:00.000Z"),
      newStart: new Date("2026-05-06T07:00:00.000Z"),
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("in_past");
  });

  it("rejects negative-duration originals (data corruption guard)", () => {
    const r = computeRescheduledSlot({
      originalStart: new Date("2026-05-06T10:00:00.000Z"),
      originalEnd: new Date("2026-05-06T09:30:00.000Z"),
      newStart: new Date("2026-05-06T11:00:00.000Z"),
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid_input");
  });

  it("rounds sub-minute remainders to the nearest minute", () => {
    const r = computeRescheduledSlot({
      originalStart: new Date("2026-05-06T09:00:00.000Z"),
      originalEnd: new Date("2026-05-06T09:25:30.000Z"),
      newStart: new Date("2026-05-06T11:00:00.000Z"),
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 25.5 min → rounds to 26.
    expect(r.durationMin).toBe(26);
  });
});
