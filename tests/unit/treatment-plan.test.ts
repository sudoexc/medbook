/**
 * Treatment plan card arithmetic (audit MA-11).
 *
 * The MedicalCase model has no planned number of visits. The card used to
 * project one (completed + next booking, at least 1), so an OPEN case with
 * one finished visit and nothing booked read «1 из 1, Лечение завершено ✓».
 * Now «completed» is the case's own RESOLVED status, and without a plan
 * length there is no «N из M» and no bar.
 */
import { describe, expect, it } from "vitest";

import { computeProgress } from "@/server/services/treatment-plan";

describe("computeProgress", () => {
  it("never calls an OPEN case finished, whatever the visit count", () => {
    const p = computeProgress({
      caseStatus: "OPEN",
      completedAppointments: 1,
      nextBookedAt: null,
    });
    expect(p.completed).toBe(false);
    expect(p.done).toBe(1);
    // No plan length: no denominator and no bar, only the visit count.
    expect(p.total).toBeNull();
    expect(p.progress).toBeNull();
    expect(p.empty).toBe(false);
  });

  it("only a RESOLVED case is «Лечение завершено»", () => {
    expect(
      computeProgress({ caseStatus: "RESOLVED", completedAppointments: 3, nextBookedAt: null })
        .completed,
    ).toBe(true);
    for (const caseStatus of ["ABANDONED", "TRANSFERRED"]) {
      expect(
        computeProgress({ caseStatus, completedAppointments: 3, nextBookedAt: null }).completed,
      ).toBe(false);
    }
  });

  it("reports the next visit and does not invent a total from it", () => {
    const next = new Date("2026-10-12T09:00:00.000Z");
    const p = computeProgress({
      caseStatus: "OPEN",
      completedAppointments: 3,
      nextBookedAt: next,
    });
    expect(p.nextVisitAt).toBe(next.toISOString());
    expect(p.total).toBeNull();
    expect(p.progress).toBeNull();
  });

  it("a brand-new case is empty", () => {
    const p = computeProgress({ caseStatus: "OPEN", completedAppointments: 0, nextBookedAt: null });
    expect(p.empty).toBe(true);
    expect(p.done).toBe(0);
    expect(p.completed).toBe(false);
  });

  it("uses a doctor-set plan length when there is one", () => {
    const p = computeProgress({
      caseStatus: "OPEN",
      completedAppointments: 1,
      nextBookedAt: null,
      plannedVisits: 5,
    });
    expect(p.total).toBe(5);
    expect(p.progress).toBeCloseTo(0.2, 5);
    // Reaching the plan does not close the case either.
    const full = computeProgress({
      caseStatus: "OPEN",
      completedAppointments: 5,
      nextBookedAt: null,
      plannedVisits: 5,
    });
    expect(full.progress).toBe(1);
    expect(full.completed).toBe(false);
  });

  it("a course that ran past its plan grows the plan instead of overflowing", () => {
    const p = computeProgress({
      caseStatus: "OPEN",
      completedAppointments: 6,
      nextBookedAt: "2026-10-12T09:00:00.000Z",
      plannedVisits: 5,
    });
    expect(p.total).toBe(7);
    expect(p.progress).toBeLessThanOrEqual(1);
  });

  it("clamps negative counts to 0 and accepts ISO strings and Dates alike", () => {
    expect(
      computeProgress({ caseStatus: "OPEN", completedAppointments: -5, nextBookedAt: null }).done,
    ).toBe(0);
    const iso = "2026-05-12T09:00:00.000Z";
    expect(
      computeProgress({ caseStatus: "OPEN", completedAppointments: 1, nextBookedAt: iso })
        .nextVisitAt,
    ).toBe(
      computeProgress({ caseStatus: "OPEN", completedAppointments: 1, nextBookedAt: new Date(iso) })
        .nextVisitAt,
    );
  });
});
