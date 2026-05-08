/**
 * Phase 16 Wave 1 — Treatment plan progress projection.
 *
 * Locks the math used by `<TreatmentPlanCard />` so the UI never has to
 * branch on edge-cases. The MedicalCase model has no explicit
 * `plannedVisits` field today, so the helper projects total from the
 * completed-count + (optionally) one upcoming booking.
 */
import { describe, expect, it } from "vitest";

import { computeProgress } from "@/server/services/treatment-plan";

describe("computeProgress", () => {
  it("treats a brand-new case (0 completed, no next) as empty with total=1", () => {
    const p = computeProgress({
      completedAppointments: 0,
      nextBookedAt: null,
    });
    expect(p.done).toBe(0);
    // We always render at least 1 in the denominator so the bar isn't NaN.
    expect(p.total).toBe(1);
    expect(p.empty).toBe(true);
    expect(p.completed).toBe(false);
    expect(p.nextVisitAt).toBeNull();
    expect(p.progress).toBe(0);
  });

  it("projects total = completed + 1 when a next visit is booked", () => {
    const next = new Date("2026-05-12T09:00:00.000Z");
    const p = computeProgress({
      completedAppointments: 3,
      nextBookedAt: next,
    });
    expect(p.done).toBe(3);
    expect(p.total).toBe(4); // 3 done + 1 booked
    expect(p.nextVisitAt).toBe(next.toISOString());
    expect(p.empty).toBe(false);
    expect(p.completed).toBe(false);
    expect(p.progress).toBeCloseTo(0.75, 5);
  });

  it("marks a case as completed when done >= total and no next booking", () => {
    const p = computeProgress({
      completedAppointments: 5,
      nextBookedAt: null,
      plannedVisits: 5,
    });
    expect(p.done).toBe(5);
    expect(p.total).toBe(5);
    expect(p.completed).toBe(true);
    expect(p.empty).toBe(false);
    expect(p.progress).toBe(1);
  });

  it("respects an explicit plannedVisits when provided and larger than projection", () => {
    const p = computeProgress({
      completedAppointments: 1,
      nextBookedAt: null,
      plannedVisits: 5,
    });
    expect(p.total).toBe(5);
    expect(p.done).toBe(1);
    expect(p.completed).toBe(false);
    expect(p.progress).toBeCloseTo(0.2, 5);
  });

  it("projects total beyond plannedVisits when reality exceeds the plan", () => {
    // Patient came back 6 times for a "5 visit" course — total clamps up.
    const next = new Date("2026-05-12T09:00:00.000Z");
    const p = computeProgress({
      completedAppointments: 6,
      nextBookedAt: next,
      plannedVisits: 5,
    });
    expect(p.total).toBe(7); // max(5, 6+1, 1)
    expect(p.completed).toBe(false);
  });

  it("accepts nextBookedAt as ISO string and Date interchangeably", () => {
    const iso = "2026-05-12T09:00:00.000Z";
    const a = computeProgress({
      completedAppointments: 1,
      nextBookedAt: iso,
    });
    const b = computeProgress({
      completedAppointments: 1,
      nextBookedAt: new Date(iso),
    });
    expect(a.nextVisitAt).toBe(b.nextVisitAt);
    expect(a.total).toBe(b.total);
    expect(a.progress).toBeCloseTo(b.progress, 10);
  });

  it("never reports progress > 1 even with bogus inputs", () => {
    const p = computeProgress({
      completedAppointments: 99,
      nextBookedAt: null,
      plannedVisits: 1,
    });
    expect(p.progress).toBe(1);
  });

  it("clamps negative completedAppointments to 0", () => {
    const p = computeProgress({
      completedAppointments: -5,
      nextBookedAt: null,
    });
    expect(p.done).toBe(0);
    expect(p.empty).toBe(true);
  });
});
